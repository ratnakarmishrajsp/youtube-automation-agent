// Event handlers shared by the webhook (instant, needs Meta Advanced Access) and
// the cron poller (every minute, works without it). KV keys dedupe between them.
//
// KV write budget (free plan: 1,000 writes/day, shared by everything):
//   - per DM only the keys that stop a second DM: p:u (follow pending) and d: (delivered),
//     plus m: when a "not following yet" reminder goes out;
//   - logs are buffered in memory and flushed as one key with the poll state (poller.js);
//   - a refused write (daily limit reached) is logged and skipped, so the DM still goes out.
import { decideCommentAction, decideMessageAction } from './flow.js';
import {
  sendPrivateReply,
  sendDirectMessage,
  postCommentReply,
  checkUserFollows,
  isRateLimitError
} from './instagram.js';

const GITHUB_REGISTRY_URL = 'https://raw.githubusercontent.com/ratnakarmishrajsp/youtube-automation-agent/master/data/auto_dm_registry.json';
const REGISTRY_TTL_MS = 5 * 60 * 1000;

// Kept in isolate memory so the cron does not spend KV writes (free plan: 1,000/day).
let registryCache = { at: 0, data: null };
// A second comment from the same user on the same reel within this window ("🙌" then
// "SKILL") gets no second DM. Later comments do: the new private reply is a reminder.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
// "mediaId:username" -> when this isolate DMed them. Covers two comments in the same
// poll batch, where the KV write of the first may not be readable yet.
const recentSends = new Map();
// Same isolate fallbacks for the two dedupe keys, used when a KV write was refused.
const memPending = new Map(); // username -> pending follow check
const memDelivered = new Set(); // "mediaId:username"
// Log events waiting for the next flush (one KV key per flush, not per event).
let logBuffer = [];
const LOG_BUFFER_MAX = 200;
const RATE_LIMIT_KEY = 'poll:rate-limit-until';
const RATE_LIMIT_PAUSE_MS = 30 * 60 * 1000;

async function pauseForRateLimit(env, err) {
  if (!isRateLimitError(err)) return;
  const until = Date.now() + RATE_LIMIT_PAUSE_MS;
  await kvPut(env, RATE_LIMIT_KEY, String(until), { expirationTtl: 3600 });
  await logEvent(env, { type: 'meta_rate_limit', until: new Date(until).toISOString(), error: err.message });
}

// Tests run several registries and users in one process.
export function resetRegistryCache() {
  registryCache = { at: 0, data: null };
  recentSends.clear();
  memPending.clear();
  memDelivered.clear();
  logBuffer = [];
}

function bufferLog(entry) {
  if (logBuffer.length >= LOG_BUFFER_MAX) logBuffer.shift();
  logBuffer.push(entry);
}

/**
 * KV put that never throws: when Cloudflare refuses the write (daily limit), the
 * caller carries on with its in-memory fallback instead of dropping the DM.
 */
export async function kvPut(env, key, value, opts) {
  if (!env.AUTO_DM) return false;
  try {
    await env.AUTO_DM.put(key, value, opts);
    return true;
  } catch (err) {
    console.error(`KV put ${key} failed: ${err.message}`);
    bufferLog({ type: 'kv_write_failed', key: key.split(':')[0], error: err.message, timestamp: new Date().toISOString() });
    return false;
  }
}

async function kvDelete(env, key) {
  if (!env.AUTO_DM) return;
  try {
    await env.AUTO_DM.delete(key);
  } catch (err) {
    console.error(`KV delete ${key} failed: ${err.message}`);
  }
}

function rememberPending(username, pending) {
  if (!username) return;
  if (memPending.size > 1000) memPending.clear();
  memPending.set(username, pending);
}

// The poller asks this when the p:u write for a user was refused.
export function hasPendingInMemory(username) {
  return Boolean(username && memPending.has(username));
}

function rememberDelivered(mediaId, username) {
  if (!username) return;
  if (memDelivered.size > 5000) memDelivered.clear();
  memDelivered.add(`${mediaId}:${username}`);
}

/**
 * Registry from GitHub (cached 5 min in memory). KV holds a fallback copy that is
 * rewritten only when the content changes.
 */
export async function getRegistry(env) {
  if (registryCache.data && Date.now() - registryCache.at < REGISTRY_TTL_MS) return registryCache.data;

  try {
    const res = await fetch(GITHUB_REGISTRY_URL, { cf: { cacheTtl: 60 } });
    if (res.ok) {
      const text = await res.text();
      const data = JSON.parse(text);
      registryCache = { at: Date.now(), data };
      if (env.AUTO_DM) {
        const stored = await env.AUTO_DM.get('cfg:registry');
        if (stored !== text) await kvPut(env, 'cfg:registry', text);
      }
      return data;
    }
  } catch (err) {
    console.error('Failed to fetch registry from GitHub:', err);
  }

  if (registryCache.data) return registryCache.data;
  if (env.AUTO_DM) {
    const fallback = await env.AUTO_DM.get('cfg:registry', { type: 'json' });
    if (fallback) return fallback;
  }
  return [];
}

/**
 * Structured log entry: Cloudflare's worker logs right away, KV at the next flush.
 */
export async function logEvent(_env, payload) {
  const entry = { ...payload, timestamp: new Date().toISOString() };
  console.log(JSON.stringify(entry));
  bufferLog(entry);
}

/**
 * Write every buffered log entry as one KV key (`log:<time>:batch`). Called by the
 * poller every 15 minutes, so logs cost at most ~96 writes a day.
 */
export async function flushLogs(env) {
  if (!env.AUTO_DM || !logBuffer.length) return;
  const batch = logBuffer;
  logBuffer = [];
  const ok = await kvPut(env, `log:${new Date().toISOString()}:batch`, JSON.stringify({ batch }), { expirationTtl: 30 * 86400 });
  if (!ok) logBuffer = batch.concat(logBuffer).slice(-LOG_BUFFER_MAX);
}

/**
 * Process one comment (from a webhook change value or from the poller)
 */
export async function handleCommentsEvent(changeValue, env, workerHost, registry) {
  const { id: commentId, text, from, media, parent_id } = changeValue || {};
  const username = from?.username;
  const mediaId = media?.id;

  if (!commentId || !mediaId) return true;

  // Read current KV state
  let commentHandled = false;
  let delivered = false;
  const sentKey = `${mediaId}:${username}`;
  const isRecent = (at) => Date.now() - (at || 0) < DUPLICATE_WINDOW_MS;
  let pending = isRecent(recentSends.get(sentKey));

  let pendingState = username ? memPending.get(username) || null : null;
  delivered = memDelivered.has(sentKey);
  if (env.AUTO_DM) {
    // c: keys are no longer written; old ones are still honoured until they expire.
    commentHandled = Boolean(await env.AUTO_DM.get(`c:${commentId}`));
    if (username) {
      delivered = delivered || Boolean(await env.AUTO_DM.get(`d:${mediaId}:${username}`));
      pendingState = (await env.AUTO_DM.get(`p:u:${username}`, { type: 'json' })) || pendingState;
    }
  }
  // The pending check carries the comment it answered, so a re-read comment is not DMed twice.
  if (pendingState?.commentId === commentId) commentHandled = true;
  if (!pending) pending = pendingState?.mediaId === mediaId && isRecent(pendingState.at);

  const decision = decideCommentAction({
    comment: { id: commentId, text, from, media, parent_id },
    registry,
    kvState: { commentHandled, delivered, pending },
    workerHost
  });

  if (decision.action === 'IGNORE') {
    return true;
  }
  const rememberSent = () => {
    if (recentSends.size > 1000) recentSends.clear();
    recentSends.set(sentKey, Date.now());
  };

  // No per-comment KV marker: d: (delivered) and p:u (pending, with the comment id) already
  // stop a second DM, and Instagram allows only one private reply per comment anyway.
  if (decision.action === 'ALREADY_DELIVERED') {
    return true;
  }

  const token = env.IG_ACCESS_TOKEN;
  if (!token) {
    await logEvent(env, { type: 'error', user: username, mediaId, error: 'IG_ACCESS_TOKEN missing' });
    return false;
  }

  if (decision.action === 'SEND_DIRECT') {
    try {
      await sendPrivateReply(commentId, decision.privateReply, token);
      rememberSent();
      rememberDelivered(mediaId, username);
      if (username) await kvPut(env, `d:${mediaId}:${username}`, '1', { expirationTtl: 365 * 86400 });
      if (decision.publicReply) {
        try {
          await postCommentReply(commentId, decision.publicReply, token);
        } catch (pubErr) {
          await pauseForRateLimit(env, pubErr);
          await logEvent(env, { type: 'public_reply_error', user: username, mediaId, error: pubErr.message });
        }
      }
      await logEvent(env, { type: 'direct_delivered', user: username, mediaId, result: 'success' });
    } catch (err) {
      await pauseForRateLimit(env, err);
      await logEvent(env, { type: 'error', user: username, mediaId, error: err.message });
      return false;
    }
    return true;
  }

  if (decision.action === 'GATE_FOLLOW') {
    // Buttons (View Profile + Followed) first; if Instagram rejects the template
    // in a private reply, fall back to the quick reply, then to plain text.
    const variants = [
      ['buttons', decision.privateReply],
      ['quick_reply', decision.quickReplyFallback],
      ['text_only', decision.textOnlyFallback],
    ].filter(([, payload]) => payload);
    let sentVariant = null;
    const failures = [];
    for (const [name, payload] of variants) {
      try {
        await sendPrivateReply(commentId, payload, token);
        sentVariant = name;
        break;
      } catch (err) {
        console.warn(`Private reply variant "${name}" failed:`, err.message);
        failures.push(`${name}: ${err.message}`);
        if (isRateLimitError(err)) {
          await pauseForRateLimit(env, err);
          break;
        }
      }
    }
    if (!sentVariant) {
      await logEvent(env, { type: 'error', user: username, mediaId, error: failures.join(' | ') });
      return false;
    }
    rememberSent();
    if (failures.length) {
      await logEvent(env, { type: 'variant_fallback', user: username, mediaId, sentVariant, failures });
    }

    // Post public confirmation on comment
    if (decision.publicReply) {
      try {
        await postCommentReply(commentId, decision.publicReply, token);
      } catch (pubErr) {
        console.warn('Public reply failed:', pubErr.message);
        await pauseForRateLimit(env, pubErr);
      }
    }

    // Store the pending follow check: one key by username (a reply is matched to it through
    // the sender's profile). p:id is only a fallback for a comment without a username.
    const pendingData = { ...decision.pendingData, variant: sentVariant };
    const ttl = 7 * 86400;
    rememberPending(username, pendingData);
    if (username) {
      await kvPut(env, `p:u:${username}`, JSON.stringify(pendingData), { expirationTtl: ttl });
    } else if (decision.igsid) {
      await kvPut(env, `p:id:${decision.igsid}`, JSON.stringify(pendingData), { expirationTtl: ttl });
    }

    await logEvent(env, {
      type: 'follow_gate_sent',
      user: username,
      mediaId,
      variant: sentVariant,
      result: 'success'
    });
    return true;
  }
  return true;
}

/**
 * Process one incoming DM (quick reply tap or typed reply)
 */
export async function handleMessagesEvent(messagingItem, env, workerHost, registry) {
  const { sender, message, postback } = messagingItem || {};
  if (message?.is_echo) return true;

  const senderId = sender?.id;
  // A "Followed ✅" button tap arrives as a postback (webhook) or as its title text (poller).
  const text = message?.text || postback?.title;
  const quickReplyPayload = message?.quick_reply?.payload || postback?.payload;
  const mid = message?.mid || postback?.mid;

  if (!senderId) return true;

  // The webhook and the poller can both see the same message; handle it once.
  if (mid && env.AUTO_DM && await env.AUTO_DM.get(`m:${mid}`)) return true;

  // Look up the pending check: legacy p:id key first, then by the sender's username.
  let pendingState = null;
  if (env.AUTO_DM) {
    pendingState = await env.AUTO_DM.get(`p:id:${senderId}`, { type: 'json' });
  }

  const token = env.IG_ACCESS_TOKEN;
  if (!token) return false;

  let username = pendingState?.username;
  // One profile call gives both the username (to find p:u) and the follow status.
  let profile = null;
  if (!pendingState) {
    try {
      profile = await checkUserFollows(senderId, token);
      username = profile.username;
      if (username) {
        pendingState = (env.AUTO_DM && await env.AUTO_DM.get(`p:u:${username}`, { type: 'json' })) || memPending.get(username) || null;
      }
    } catch {
      // ignore
    }
  }

  if (!pendingState) {
    return true; // Ignore regular unrelated DMs
  }

  // Only replies sent after our follow instructions count.
  const sentAtMs = messagingItem.timestamp || 0;
  if (sentAtMs && pendingState.at && sentAtMs < pendingState.at) return true;

  const registryEntry = (registry || []).find(r => r.mediaId === pendingState.mediaId);

  // Check if following
  let isFollowing = false;
  try {
    if (!profile) profile = await checkUserFollows(senderId, token);
    isFollowing = profile.isFollowing;
    if (profile.username) username = profile.username;
  } catch (err) {
    await logEvent(env, { type: 'follow_check_error', user: username, senderId, error: err.message });
    return false;
  }

  const decision = decideMessageAction({
    text,
    quickReplyPayload,
    pendingState,
    isFollowing,
    registryEntry,
    workerHost
  });

  if (decision.action === 'IGNORE') return true;

  if (decision.action === 'DELIVER_RESOURCES') {
    // Delivery clears the pending check, so a re-read "Done" finds nothing; d: also guards
    // the case where that delete did not go through.
    const deliveredKey = `${pendingState.mediaId}:${username}`;
    if (username && (memDelivered.has(deliveredKey) || (env.AUTO_DM && await env.AUTO_DM.get(`d:${deliveredKey}`)))) return true;
    try {
      await sendDirectMessage(senderId, { text: decision.messageText }, token);

      if (username) {
        rememberDelivered(pendingState.mediaId, username);
        memPending.delete(username);
        await kvPut(env, `d:${deliveredKey}`, '1', { expirationTtl: 365 * 86400 });
        await kvDelete(env, `p:u:${username}`);
      }
      await kvDelete(env, `p:id:${senderId}`);

      await logEvent(env, {
        type: 'resources_delivered',
        user: username,
        mediaId: pendingState.mediaId,
        result: 'success'
      });
    } catch (err) {
      await pauseForRateLimit(env, err);
      await logEvent(env, { type: 'error', user: username, mediaId: pendingState.mediaId, error: err.message });
      return false;
    }
    return true;
  }

  if (decision.action === 'ASK_AGAIN') {
    try {
      try {
        await sendDirectMessage(senderId, decision.reply, token);
      } catch (btnErr) {
        if (!decision.replyFallback) throw btnErr;
        console.warn('Button reminder failed, sending quick reply:', btnErr.message);
        await sendDirectMessage(senderId, decision.replyFallback, token);
      }
      // Mark only after Meta accepted the reminder; a failed send can then retry.
      if (mid) await kvPut(env, `m:${mid}`, '1', { expirationTtl: 7 * 86400 });
      const updated = { ...pendingState, tries: decision.newTries };
      if (username) {
        rememberPending(username, updated);
        await kvPut(env, `p:u:${username}`, JSON.stringify(updated), { expirationTtl: 7 * 86400 });
        await kvDelete(env, `p:id:${senderId}`);
      } else {
        await kvPut(env, `p:id:${senderId}`, JSON.stringify(updated), { expirationTtl: 7 * 86400 });
      }
      await logEvent(env, {
        type: 'follow_check_retry',
        user: username,
        tries: decision.newTries,
        result: 'not_following'
      });
    } catch (err) {
      await pauseForRateLimit(env, err);
      await logEvent(env, { type: 'error', user: username, error: err.message });
      return false;
    }
    return true;
  }

  if (decision.action === 'MAX_TRIES_EXCEEDED') {
    await kvDelete(env, `p:id:${senderId}`);
    if (username) {
      memPending.delete(username);
      await kvDelete(env, `p:u:${username}`);
    }
    await logEvent(env, {
      type: 'follow_check_abandoned',
      user: username,
      mediaId: pendingState.mediaId,
      result: 'max_tries_exceeded'
    });
  }
  return true;
}

/**
 * Handle incoming webhook payload
 */
export async function processWebhookPayload(rawBody, env, workerHost) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return;
  }

  const registry = await getRegistry(env);

  for (const entry of body.entry || []) {
    // 1. Process comments
    for (const change of entry.changes || []) {
      if (change.field === 'comments' && change.value) {
        await handleCommentsEvent(change.value, env, workerHost, registry);
      }
    }

    // 2. Process messages
    for (const messagingItem of entry.messaging || []) {
      await handleMessagesEvent(messagingItem, env, workerHost, registry);
    }
  }
}
