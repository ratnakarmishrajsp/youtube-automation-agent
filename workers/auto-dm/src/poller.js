// Cron poller (every minute). Meta only sends comment webhooks to apps with
// Advanced Access, so until App Review is approved this is what makes auto-DM
// work. It reads new comments and new DM replies and feeds them to the same
// handlers as the webhook; the pending/delivered keys stop anything being handled twice.
//
// The high-water marks live in isolate memory and go to KV at most every 15 minutes
// (free plan: 1,000 writes/day, and this used to write every active minute). After a
// cold start the last saved marks are used, so up to 15 minutes of comments and replies
// are read again; the handlers recognise them and send nothing new.
import { graphGet } from './instagram.js';
import { getRegistry, handleCommentsEvent, handleMessagesEvent, logEvent, flushLogs, kvPut, hasPendingInMemory } from './handlers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const COMMENT_WINDOW_MS = 7 * DAY_MS; // Instagram: private reply within 7 days of the COMMENT (reel age doesn't matter)
const LEGACY_REEL_WINDOW_MS = 7 * DAY_MS; // old reels (registered before followGate existed) age out
const MAX_MEDIA_PAGES = 5;
const MAX_COMMENT_PAGES = 10;
const STATE_KEY = 'poll:state';
const FLUSH_EVERY_MS = 15 * 60 * 1000;

let memState = null; // poll state kept between cron runs of this isolate
let stateDirty = false; // memState has changes not yet in KV
let lastFlushAt = 0;

// Tests simulate a cold start with this.
export function resetPollMemory() {
  memState = null;
  stateDirty = false;
  lastFlushAt = 0;
}

// Instagram timestamps look like "2026-10-10T16:16:29+0000".
const toMs = (ts) => Date.parse(String(ts || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) || 0;

// Reels published through Publish_Reel always carry `followGate`, so they stay
// automated forever: someone commenting two months later still gets the DM.
// Older entries without it are only watched for their first week.
function watchedReels(registry, now) {
  return new Map(
    registry
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
      if (at <= highWater || now - at > COMMENT_WINDOW_MS) {
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
  for (const [mediaId, count] of counts) {
    if (count === state.counts[mediaId]) continue;

    const highWater = state.hw[mediaId] || 0;
    let newest = highWater;
    for (const c of await newComments(mediaId, highWater, now, token)) {
      newest = Math.max(newest, c.at);
      const from = c.from || { username: c.username };
      if (!from.username && c.username) from.username = c.username;
      await handleCommentsEvent({ id: c.id, text: c.text, from, media: { id: mediaId } }, env, workerHost, registry);
    }
    state.counts[mediaId] = count;
    state.hw[mediaId] = newest;
    state.changed = true;
  }
}

async function pollReplies(env, workerHost, registry, state, token) {
  const convs = await graphGet('me/conversations', {
    platform: 'instagram',
    fields: 'updated_time,participants,messages.limit(5){id,message,created_time,from}',
    limit: '10',
  }, token);

  let newest = state.convAt || 0;
  for (const conv of convs.data || []) {
    const updated = toMs(conv.updated_time);
    if (updated <= (state.convAt || 0)) continue;
    newest = Math.max(newest, updated);

    const own = env.IG_ACCOUNT_ID ? String(env.IG_ACCOUNT_ID) : null;
    const other = (conv.participants?.data || []).find((p) => p.username !== 'ratnakarcontent' && p.id !== own);
    if (!other) continue;
    const pending = hasPendingInMemory(other.username) ||
      await env.AUTO_DM.get(`p:id:${other.id}`) || await env.AUTO_DM.get(`p:u:${other.username}`);
    if (!pending) continue;

    // Oldest first, so "followed" is checked in the order the user sent things.
    const messages = (conv.messages?.data || []).filter((m) => m.from?.id === other.id).reverse();
    for (const m of messages) {
      await handleMessagesEvent(
        { sender: { id: other.id }, timestamp: toMs(m.created_time), message: { mid: m.id, text: m.message || '' } },
        env, workerHost, registry
      );
    }
  }
  if (newest !== (state.convAt || 0)) {
    state.convAt = newest;
    state.changed = true;
  }
}

export async function runPoll(env) {
  if (!env.AUTO_DM || !env.IG_ACCESS_TOKEN) return;
  const workerHost = env.WORKER_HOST;
  const token = env.IG_ACCESS_TOKEN;
  const registry = await getRegistry(env);
  if (!memState) {
    memState = (await env.AUTO_DM.get(STATE_KEY, { type: 'json' })) || { counts: {}, hw: {}, convAt: 0 };
    lastFlushAt = Date.now();
  }
  const state = memState;
  state.counts = state.counts || {};
  state.hw = state.hw || {};

  for (const [name, step] of [['comments', pollComments], ['replies', pollReplies]]) {
    try {
      await step(env, workerHost, registry, state, token);
    } catch (err) {
      await logEvent(env, { type: 'poll_error', step: name, error: err.message });
    }
  }

  if (state.changed) {
    delete state.changed;
    stateDirty = true;
  }
  if (Date.now() - lastFlushAt >= FLUSH_EVERY_MS) {
    lastFlushAt = Date.now();
    if (stateDirty && await kvPut(env, STATE_KEY, JSON.stringify(state))) stateDirty = false;
    await flushLogs(env);
  }
}
