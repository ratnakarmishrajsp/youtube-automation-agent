// Cron poller (every minute). Meta only sends comment webhooks to apps with
// Advanced Access, so until App Review is approved this is what makes auto-DM
// work. It reads new comments and new DM replies and feeds them to the same
// handlers as the webhook; KV keys (c:, m:) stop anything being handled twice.
import { graphGet } from './instagram.js';
import { getRegistry, handleCommentsEvent, handleMessagesEvent, logEvent } from './handlers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 7 * DAY_MS; // private replies are only allowed for 7 days
const STATE_KEY = 'poll:state';

// Instagram timestamps look like "2026-10-10T16:16:29+0000".
const toMs = (ts) => Date.parse(String(ts || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) || 0;

async function pollComments(env, workerHost, registry, state, token) {
  const now = Date.now();
  const active = new Map(
    registry
      .filter((e) => e.mediaId && now - toMs(e.publishedAt) < ACTIVE_WINDOW_MS)
      .map((e) => [e.mediaId, e])
  );
  if (!active.size) return;

  // One call tells us which reels got new comments since the last run.
  const media = await graphGet('me/media', { fields: 'id,comments_count', limit: '25' }, token);
  for (const item of media.data || []) {
    if (!active.has(item.id)) continue;
    const count = item.comments_count || 0;
    if (count === state.counts[item.id]) continue;

    const highWater = state.hw[item.id] || 0;
    const comments = await graphGet(`${item.id}/comments`, { fields: 'id,text,timestamp,from,username', limit: '50' }, token);
    let newest = highWater;
    for (const c of comments.data || []) {
      const at = toMs(c.timestamp);
      if (at <= highWater || now - at > ACTIVE_WINDOW_MS) continue;
      newest = Math.max(newest, at);
      const from = c.from || { username: c.username };
      if (!from.username && c.username) from.username = c.username;
      await handleCommentsEvent({ id: c.id, text: c.text, from, media: { id: item.id } }, env, workerHost, registry);
    }
    state.counts[item.id] = count;
    state.hw[item.id] = newest;
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
    const pending = await env.AUTO_DM.get(`p:id:${other.id}`) || await env.AUTO_DM.get(`p:u:${other.username}`);
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
  const state = (await env.AUTO_DM.get(STATE_KEY, { type: 'json' })) || { counts: {}, hw: {}, convAt: 0 };
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
    await env.AUTO_DM.put(STATE_KEY, JSON.stringify(state));
  }
}
