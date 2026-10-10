// Event handlers shared by the webhook (instant, needs Meta Advanced Access) and
// the cron poller (every minute, works without it). KV keys dedupe between them.
import { decideCommentAction, decideMessageAction } from './flow.js';
import {
  sendPrivateReply,
  sendDirectMessage,
  postCommentReply,
  checkUserFollows
} from './instagram.js';

const GITHUB_REGISTRY_URL = 'https://raw.githubusercontent.com/ratnakarmishrajsp/youtube-automation-agent/master/data/auto_dm_registry.json';
const REGISTRY_TTL_MS = 5 * 60 * 1000;

// Kept in isolate memory so the cron does not spend KV writes (free plan: 1,000/day).
let registryCache = { at: 0, data: null };

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
        if (stored !== text) await env.AUTO_DM.put('cfg:registry', text);
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
 * Write structured log entry to KV
 */
export async function logEvent(env, payload) {
  if (!env.AUTO_DM) return;
  const logKey = `log:${new Date().toISOString()}:${Math.random().toString(36).slice(2, 7)}`;
  await env.AUTO_DM.put(logKey, JSON.stringify({
    ...payload,
    timestamp: new Date().toISOString()
  }), { expirationTtl: 30 * 86400 });
}

/**
 * Process one comment (from a webhook change value or from the poller)
 */
export async function handleCommentsEvent(changeValue, env, workerHost, registry) {
  const { id: commentId, text, from, media, parent_id } = changeValue || {};
  const username = from?.username;
  const mediaId = media?.id;

  if (!commentId || !mediaId) return;

  // Read current KV state
  let commentHandled = false;
  let delivered = false;

  if (env.AUTO_DM) {
    commentHandled = Boolean(await env.AUTO_DM.get(`c:${commentId}`));
    if (username) {
      delivered = Boolean(await env.AUTO_DM.get(`d:${mediaId}:${username}`));
    }
  }

  const decision = decideCommentAction({
    comment: { id: commentId, text, from, media, parent_id },
    registry,
    kvState: { commentHandled, delivered },
    workerHost
  });

  if (decision.action === 'IGNORE') {
    return;
  }

  // Mark comment as processed immediately to prevent duplicate handling
  if (env.AUTO_DM) {
    await env.AUTO_DM.put(`c:${commentId}`, JSON.stringify({ at: Date.now() }), { expirationTtl: 30 * 86400 });
  }

  if (decision.action === 'ALREADY_DELIVERED') {
    await logEvent(env, { type: 'comment_skipped', user: username, mediaId, result: 'already_delivered' });
    return;
  }

  const token = env.IG_ACCESS_TOKEN;
  if (!token) {
    await logEvent(env, { type: 'error', user: username, mediaId, error: 'IG_ACCESS_TOKEN missing' });
    return;
  }

  if (decision.action === 'SEND_DIRECT') {
    try {
      await sendPrivateReply(commentId, decision.privateReply, token);
      if (decision.publicReply) {
        await postCommentReply(commentId, decision.publicReply, token);
      }
      if (env.AUTO_DM && username) {
        await env.AUTO_DM.put(`d:${mediaId}:${username}`, '1', { expirationTtl: 365 * 86400 });
      }
      await logEvent(env, { type: 'direct_delivered', user: username, mediaId, result: 'success' });
    } catch (err) {
      await logEvent(env, { type: 'error', user: username, mediaId, error: err.message });
    }
    return;
  }

  if (decision.action === 'GATE_FOLLOW') {
    let sentVariant = 'quick_reply';
    try {
      // Try sending with quick reply first
      await sendPrivateReply(commentId, decision.privateReply, token);
    } catch (qrErr) {
      // If quick replies are rejected in private reply, fall back to text only
      console.warn('Quick reply failed in private reply, falling back to text-only:', qrErr.message);
      try {
        await sendPrivateReply(commentId, decision.textOnlyFallback, token);
        sentVariant = 'text_only';
      } catch (textErr) {
        await logEvent(env, { type: 'error', user: username, mediaId, error: textErr.message, firstError: qrErr.message });
        return;
      }
    }

    // Post public confirmation on comment
    if (decision.publicReply) {
      try {
        await postCommentReply(commentId, decision.publicReply, token);
      } catch (pubErr) {
        console.warn('Public reply failed:', pubErr.message);
      }
    }

    // Store pending follow check in KV
    if (env.AUTO_DM) {
      const pendingJson = JSON.stringify({
        ...decision.pendingData,
        variant: sentVariant
      });
      const ttl = 7 * 86400;
      if (decision.igsid) {
        await env.AUTO_DM.put(`p:id:${decision.igsid}`, pendingJson, { expirationTtl: ttl });
      }
      if (username) {
        await env.AUTO_DM.put(`p:u:${username}`, pendingJson, { expirationTtl: ttl });
      }
    }

    await logEvent(env, {
      type: 'follow_gate_sent',
      user: username,
      mediaId,
      variant: sentVariant,
      result: 'success'
    });
  }
}

/**
 * Process one incoming DM (quick reply tap or typed reply)
 */
export async function handleMessagesEvent(messagingItem, env, workerHost, registry) {
  const { sender, message } = messagingItem || {};
  if (message?.is_echo) return;

  const senderId = sender?.id;
  const text = message?.text;
  const quickReplyPayload = message?.quick_reply?.payload;
  const mid = message?.mid;

  if (!senderId) return;

  // The webhook and the poller can both see the same message; handle it once.
  if (mid && env.AUTO_DM && await env.AUTO_DM.get(`m:${mid}`)) return;

  // Look up pending check
  let pendingState = null;
  if (env.AUTO_DM) {
    pendingState = await env.AUTO_DM.get(`p:id:${senderId}`, { type: 'json' });
  }

  const token = env.IG_ACCESS_TOKEN;
  if (!token) return;

  // If pending not found by IGSID, try username lookup
  let username = pendingState?.username;
  if (!pendingState && env.AUTO_DM) {
    try {
      const profile = await checkUserFollows(senderId, token);
      username = profile.username;
      if (username) {
        pendingState = await env.AUTO_DM.get(`p:u:${username}`, { type: 'json' });
      }
    } catch {
      // ignore
    }
  }

  if (!pendingState) {
    return; // Ignore regular unrelated DMs
  }

  // Only replies sent after our follow instructions count.
  const sentAtMs = messagingItem.timestamp || 0;
  if (sentAtMs && pendingState.at && sentAtMs < pendingState.at) return;

  const registryEntry = (registry || []).find(r => r.mediaId === pendingState.mediaId);

  // Check if following
  let isFollowing = false;
  try {
    const profile = await checkUserFollows(senderId, token);
    isFollowing = profile.isFollowing;
    if (profile.username) username = profile.username;
  } catch (err) {
    await logEvent(env, { type: 'follow_check_error', user: username, senderId, error: err.message });
    return;
  }

  const decision = decideMessageAction({
    text,
    quickReplyPayload,
    pendingState,
    isFollowing,
    registryEntry,
    workerHost
  });

  if (decision.action === 'IGNORE') return;

  if (mid && env.AUTO_DM) {
    await env.AUTO_DM.put(`m:${mid}`, '1', { expirationTtl: 7 * 86400 });
  }

  if (decision.action === 'DELIVER_RESOURCES') {
    try {
      await sendDirectMessage(senderId, { text: decision.messageText }, token);

      if (env.AUTO_DM) {
        if (username) {
          await env.AUTO_DM.put(`d:${pendingState.mediaId}:${username}`, '1', { expirationTtl: 365 * 86400 });
          await env.AUTO_DM.delete(`p:u:${username}`);
        }
        await env.AUTO_DM.delete(`p:id:${senderId}`);
      }

      await logEvent(env, {
        type: 'resources_delivered',
        user: username,
        mediaId: pendingState.mediaId,
        result: 'success'
      });
    } catch (err) {
      await logEvent(env, { type: 'error', user: username, mediaId: pendingState.mediaId, error: err.message });
    }
    return;
  }

  if (decision.action === 'ASK_AGAIN') {
    try {
      await sendDirectMessage(senderId, decision.reply, token);
      if (env.AUTO_DM) {
        const updated = JSON.stringify({
          ...pendingState,
          tries: decision.newTries
        });
        await env.AUTO_DM.put(`p:id:${senderId}`, updated, { expirationTtl: 7 * 86400 });
        if (username) {
          await env.AUTO_DM.put(`p:u:${username}`, updated, { expirationTtl: 7 * 86400 });
        }
      }
      await logEvent(env, {
        type: 'follow_check_retry',
        user: username,
        tries: decision.newTries,
        result: 'not_following'
      });
    } catch (err) {
      await logEvent(env, { type: 'error', user: username, error: err.message });
    }
    return;
  }

  if (decision.action === 'MAX_TRIES_EXCEEDED') {
    if (env.AUTO_DM) {
      await env.AUTO_DM.delete(`p:id:${senderId}`);
      if (username) await env.AUTO_DM.delete(`p:u:${username}`);
    }
    await logEvent(env, {
      type: 'follow_check_abandoned',
      user: username,
      mediaId: pendingState.mediaId,
      result: 'max_tries_exceeded'
    });
  }
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
