const GRAPH_URL = 'https://graph.instagram.com/v20.0';

/**
 * Send a private reply to a comment.
 * Payload can be { text } or { text, quick_replies: [...] }
 */
export async function sendPrivateReply(commentId, messagePayload, token) {
  const url = `${GRAPH_URL}/me/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: messagePayload,
      access_token: token
    })
  });
  const data = await res.json();
  if (data?.error) {
    const err = new Error(`sendPrivateReply failed: ${data.error.message}`);
    err.graphError = data.error;
    throw err;
  }
  return data;
}

/**
 * Send a direct message to a user by IGSID (within 24h window after user messaged).
 */
export async function sendDirectMessage(recipientIgsid, messagePayload, token) {
  const url = `${GRAPH_URL}/me/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientIgsid },
      message: messagePayload,
      access_token: token
    })
  });
  const data = await res.json();
  if (data?.error) {
    const err = new Error(`sendDirectMessage failed: ${data.error.message}`);
    err.graphError = data.error;
    throw err;
  }
  return data;
}

/**
 * Post a public reply to a comment on the reel.
 */
export async function postCommentReply(commentId, text, token) {
  const url = `${GRAPH_URL}/${commentId}/replies`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: text,
      access_token: token
    })
  });
  const data = await res.json();
  if (data?.error) {
    const err = new Error(`postCommentReply failed: ${data.error.message}`);
    err.graphError = data.error;
    throw err;
  }
  return data;
}

/**
 * Generic GET against the Graph API (used by the cron poller).
 */
export async function graphGet(path, params, token) {
  const url = new URL(`${GRAPH_URL}/${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  const res = await fetch(url);
  const data = await res.json();
  if (data?.error) {
    const err = new Error(`GET ${path} failed: ${data.error.message}`);
    err.graphError = data.error;
    throw err;
  }
  return data;
}

/**
 * Check if the user follows the business account.
 * Note: Only succeeds after the user has sent a message.
 */
export async function checkUserFollows(igsid, token) {
  const url = `${GRAPH_URL}/${igsid}?fields=username,is_user_follow_business&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data?.error) {
    const err = new Error(`checkUserFollows failed: ${data.error.message}`);
    err.graphError = data.error;
    throw err;
  }
  return {
    username: data.username,
    isFollowing: Boolean(data.is_user_follow_business)
  };
}
