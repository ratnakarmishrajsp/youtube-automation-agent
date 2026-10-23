// Cron poller (every five minutes). Meta only sends comment webhooks to apps with
// Advanced Access, so until App Review is approved this is what makes auto-DM
// work. It reads new comments and new DM replies and feeds them to the same
// handlers as the webhook; the pending/delivered keys stop anything being handled twice.
//
// Every run saves its high-water marks. Cron invocations often start in a new
// isolate, so memory-only marks caused the same failed sends to retry every minute.
import { graphGet } from './instagram.js';
import {
  getRegistry, handleCommentsEvent, handleMessagesEvent, logEvent, flushLogs, kvPut, hasPendingInMemory,
  startRun, sendBudgetLeft, MAX_SEND_FAILURES,
} from './handlers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const COMMENT_WINDOW_MS = 7 * DAY_MS; // Instagram: private reply within 7 days of the COMMENT (reel age doesn't matter)
const LEGACY_REEL_WINDOW_MS = 7 * DAY_MS; // old reels (registered before followGate existed) age out
const MAX_MEDIA_PAGES = 5;
const MAX_COMMENT_PAGES = 10;
const MAX_CONVERSATION_PAGES = 3;
// Instagram only lets a business message someone within 24h of their last message.
const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_COMMENTS_PER_POLL = 12;
const MAX_COMMENTS_PER_MEDIA = 6;
const STATE_KEY = 'poll:state';
const RATE_LIMIT_KEY = 'poll:rate-limit-until';

let memState = null; // poll state kept between cron runs of this isolate

// Tests simulate a cold start with this.
export function resetPollMemory() {
  memState = null;
}

// Instagram timestamps look like "2026-10-10T16:16:29+0000".
const toMs = (ts) => Date.parse(String(ts || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) || 0;

// Reels published through Publish_Reel always carry `followGate`, so they stay
// automated forever: someone commenting two months later still gets the DM.
// Older entries without it are only watched for their first week.
function watchedReels(registry, now) {
  return new Map(
    [...registry].reverse()
      .filter((e) => e.mediaId && (e.followGate !== undefined || now - toMs(e.publishedAt) < LEGACY_REEL_WINDOW_MS))
      .map((e) => [e.mediaId, e])
  );
}

// comments_count of every watched reel, in as few calls as possible (100 posts per page).
async function commentCounts(watched, token) {
  const counts = new Map();
  let page = await graphGet('me/media', { fields: 'id,comments_count', limit: '100' }, token);
  for (let i = 0; page; i++) {
    for (const item of page.data || []) {
      if (watched.has(item.id)) counts.set(item.id, item.comments_count || 0);
    }
    if (counts.size === watched.size || !page.paging?.next || i + 1 >= MAX_MEDIA_PAGES) break;
    const after = new URL(page.paging.next).searchParams.get('after');
    page = await graphGet('me/media', { fields: 'id,comments_count', limit: '100', after }, token);
  }
  return counts;
}

// Comments newer than `highWater`. The API returns newest first, so stop at the first old one.
async function newComments(mediaId, highWater, now, token) {
  const out = [];
  let page = await graphGet(`${mediaId}/comments`, { fields: 'id,text,timestamp,from,username', limit: '50' }, token);
  for (let i = 0; page; i++) {
    let reachedOld = false;
    for (const c of page.data || []) {
      const at = toMs(c.timestamp);
      if (at < highWater || now - at > COMMENT_WINDOW_MS) {
        reachedOld = true;
        continue;
      }
      out.push({ ...c, at });
    }
    if (reachedOld || !page.paging?.next || i + 1 >= MAX_COMMENT_PAGES) break;
    const after = new URL(page.paging.next).searchParams.get('after');
    page = await graphGet(`${mediaId}/comments`, { fields: 'id,text,timestamp,from,username', limit: '50', after }, token);
  }
  return out.sort((a, b) => a.at - b.at);
}

async function pollComments(env, workerHost, registry, state, token) {
  const now = Date.now();
  const watched = watchedReels(registry, now);
  if (!watched.size) return;

  const counts = await commentCounts(watched, token);
  let processed = 0;
  state.fails = state.fails || {};
  for (const [mediaId, count] of counts) {
    if (count === state.counts[mediaId]) continue;

    const highWater = state.hw[mediaId] || 0;
    const comments = await newComments(mediaId, highWater, now, token);
    let processedForMedia = 0;
    // Serve fresh requests before draining a long backlog. Keep the high-water
    // mark on the contiguous oldest comments only, so older requests are not lost.
    const fresh = comments.slice(-Math.ceil(MAX_COMMENTS_PER_MEDIA / 2)).reverse();
    const freshIds = new Set(fresh.map((c) => c.id));
    const ordered = [...fresh, ...comments.filter((c) => !freshIds.has(c.id))];
    const completed = new Set();
    let oldestIndex = 0;
    for (const c of ordered) {
      if (processed >= MAX_COMMENTS_PER_POLL || !sendBudgetLeft(env)) return;
      if (processedForMedia >= MAX_COMMENTS_PER_MEDIA) break;
      const from = c.from || { username: c.username };
      if (!from.username && c.username) from.username = c.username;
      const ok = await handleCommentsEvent({ id: c.id, text: c.text, from, media: { id: mediaId } }, env, workerHost, registry);
      if (await env.AUTO_DM.get(RATE_LIMIT_KEY)) return;
      processed++;
      processedForMedia++;
      if (!ok) {
        // A comment that keeps failing (deleted, already answered by hand) is
        // skipped after a few runs instead of stopping every comment behind it.
        state.fails[c.id] = (state.fails[c.id] || 0) + 1;
        state.changed = true;
        if (state.fails[c.id] < MAX_SEND_FAILURES) continue;
        await logEvent(env, { type: 'comment_abandoned', user: from.username, mediaId, commentId: c.id });
      }
      delete state.fails[c.id];
      completed.add(c.id);
      while (oldestIndex < comments.length && completed.has(comments[oldestIndex].id)) {
        state.hw[mediaId] = Math.max(state.hw[mediaId] || 0, comments[oldestIndex].at);
        oldestIndex++;
        state.changed = true;
      }
    }
    if (completed.size === comments.length) {
      state.counts[mediaId] = count;
      state.changed = true;
    }
  }
}

async function pollReplies(env, workerHost, registry, state, token) {
  let newest = state.convAt || 0;
  let after;
  for (let pageIndex = 0; pageIndex < MAX_CONVERSATION_PAGES; pageIndex++) {
    const convs = await graphGet('me/conversations', {
      platform: 'instagram',
      fields: 'updated_time,participants,messages.limit(5){id,message,created_time,from}',
      limit: '50',
      ...(after ? { after } : {}),
    }, token);
    for (const conv of convs.data || []) {
      newest = Math.max(newest, toMs(conv.updated_time));

      const own = env.IG_ACCOUNT_ID ? String(env.IG_ACCOUNT_ID) : null;
      const other = (conv.participants?.data || []).find((p) => p.username !== 'ratnakarcontent' && p.id !== own);
      if (!other) continue;
      const pending = hasPendingInMemory(other.username) ||
        (other.username && await env.AUTO_DM.get(`p:u:${other.username}`)) || await env.AUTO_DM.get(`p:id:${other.id}`);
      if (!pending) continue;

      // Revisit pending conversations even if the old poller moved convAt past
      // a reply whose resource send failed. The delivered/reminder keys dedupe.
      const messages = (conv.messages?.data || []).filter((m) => m.from?.id === other.id).reverse();
      // Past the 24h window Instagram refuses any message: nothing to try.
      if (!messages.length || Date.now() - toMs(messages[messages.length - 1].created_time) > MESSAGING_WINDOW_MS) continue;
      for (const m of messages) {
        if (!sendBudgetLeft(env)) return;
        const ok = await handleMessagesEvent(
          { sender: { id: other.id, username: other.username }, timestamp: toMs(m.created_time), message: { mid: m.id, text: m.message || '' } },
          env, workerHost, registry
        );
        if (await env.AUTO_DM.get(RATE_LIMIT_KEY)) return;
        // A failed send for this user (not a spam limit) is counted in its pending
        // record; move on to the next conversation instead of stopping the queue.
        if (!ok) break;
      }
    }
    if (!convs.paging?.next) break;
    after = new URL(convs.paging.next).searchParams.get('after');
    if (!after) break;
  }
  if (newest !== (state.convAt || 0)) {
    state.convAt = newest;
    state.changed = true;
  }
}

export async function runPoll(env) {
  if (!env.AUTO_DM || !env.IG_ACCESS_TOKEN) return;
  const pausedUntil = Number(await env.AUTO_DM.get(RATE_LIMIT_KEY)) || 0;
  if (pausedUntil > Date.now()) return;
  const workerHost = env.WORKER_HOST;
  const token = env.IG_ACCESS_TOKEN;
  const registry = await getRegistry(env);
  if (!memState) {
    memState = (await env.AUTO_DM.get(STATE_KEY, { type: 'json' })) || { counts: {}, hw: {}, convAt: 0 };
  }
  const state = memState;
  startRun();
  state.counts = state.counts || {};
  state.hw = state.hw || {};

  // Pending resource requests take priority over new comment prompts. A Meta
  // send limit in the comments pass must not starve people waiting for a PDF.
  for (const [name, step] of [['replies', pollReplies], ['comments', pollComments]]) {
    if (Number(await env.AUTO_DM.get(RATE_LIMIT_KEY)) > Date.now()) break;
    try {
      await step(env, workerHost, registry, state, token);
    } catch (err) {
      await logEvent(env, { type: 'poll_error', step: name, error: err.message });
    }
  }

  if (state.changed) {
    delete state.changed;
    await kvPut(env, STATE_KEY, JSON.stringify(state));
  }
  await flushLogs(env);
}
