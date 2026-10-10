export const OWN_USERNAME = 'ratnakarcontent';

// True when two equal-length words differ by one wrong letter or one swapped
// adjacent pair ("calude" vs "claude"). Length changes are not allowed, so
// "emotion" never matches "remotion".
function isOneTypoAway(word, keyword) {
  if (word.length !== keyword.length || word === keyword) return word === keyword;
  const diffs = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] !== keyword[i]) diffs.push(i);
    if (diffs.length > 2) return false;
  }
  if (diffs.length === 1) return true;
  const [a, b] = diffs;
  return b === a + 1 && word[a] === keyword[b] && word[b] === keyword[a];
}

/**
 * Matches keyword at word boundary, case-insensitive.
 * e.g. "claude" matches "CLAUDE", "Claude please", "claudeai" — but not "unclaude".
 * Keywords of 5+ letters also match a one-letter typo ("Calude", "Cluade").
 */
export function matchesKeyword(text, keywords) {
  if (!text || !Array.isArray(keywords) || keywords.length === 0) return false;
  const lower = String(text).toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return keywords.some((k) => {
    const keyword = String(k).toLowerCase();
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9])${escaped}`).test(lower)) return true;
    return keyword.length >= 5 && words.some((w) => isOneTypoAway(w, keyword));
  });
}

/**
 * Determines whether an incoming message is an affirmative follow confirmation.
 */
export function isAffirmativeResponse(text, quickReplyPayload) {
  if (quickReplyPayload === 'FOLLOWED') return true;
  if (!text) return false;
  const normalized = String(text).trim();
  return /^\s*(done|followed|follow (kar )?diya|ho gaya|followed ✅)\s*$/i.test(normalized);
}

/**
 * Builds the resources delivery text message.
 */
export function buildResourcesMessage({ pdfTitle, pdfUrl, youtubeUrl }) {
  let msg = `✅ Thanks for following!\n\n`;
  if (pdfTitle && pdfUrl) {
    msg += `📄 ${pdfTitle}: ${pdfUrl}\n`;
  }
  if (youtubeUrl) {
    msg += `📺 Full video: ${youtubeUrl}\n`;
  }
  msg += `\nKoi sawaal ho to yahin reply karo 🙂`;
  return msg.trim();
}

/**
 * Pure decision engine for comments events.
 */
export function decideCommentAction({ comment, registry, kvState, workerHost }) {
  const { id: commentId, text, from, media, parent_id } = comment || {};
  const username = from?.username;
  const mediaId = media?.id;

  // 1. Ignore own comments or replies
  if (!username || username.toLowerCase() === OWN_USERNAME.toLowerCase()) {
    return { action: 'IGNORE', reason: 'own_comment' };
  }
  if (parent_id) {
    return { action: 'IGNORE', reason: 'comment_reply' };
  }

  // 2. Ignore already processed comment
  if (kvState?.commentHandled) {
    return { action: 'IGNORE', reason: 'comment_already_handled' };
  }

  // 3. Find matching reel in registry
  const entry = (registry || []).find(r => r.mediaId === mediaId);
  if (!entry) {
    return { action: 'IGNORE', reason: 'media_not_in_registry' };
  }

  // 4. Keyword check
  const keywords = entry.keywords || (entry.keyword ? [entry.keyword] : []);
  if (!matchesKeyword(text, keywords)) {
    return { action: 'IGNORE', reason: 'keyword_mismatch' };
  }

  // 5. Check if user was already delivered resources for this reel
  if (kvState?.delivered) {
    return { action: 'ALREADY_DELIVERED', reason: 'already_delivered_for_media' };
  }

  const followGate = entry.followGate || 'none';
  const pdfSlug = entry.pdfSlug || entry.dm?.pdf?.slug;
  const pdfTitle = entry.pdfTitle || entry.dm?.pdf?.title || 'Resource Guide';
  const pdfUrl = pdfSlug ? `https://${workerHost}/pdf/${pdfSlug}` : null;
  const youtubeUrl = entry.youtubeUrl || entry.link || entry.dm?.link;

  // If followGate === "none", deliver immediately
  if (followGate === 'none') {
    const resourcesMsg = entry.dmMessage || buildResourcesMessage({ pdfTitle, pdfUrl, youtubeUrl });
    const replyComment = entry.replyComment || `@${username} DM check karo 📩`;
    return {
      action: 'SEND_DIRECT',
      mediaId,
      commentId,
      username,
      privateReply: { text: resourcesMsg },
      publicReply: replyComment
    };
  }

  // Follow-gate active: instruct user to follow
  const title = entry.title || 'Masterclass & Guide';
  let initialDmText;
  if (followGate === 'pdf' && youtubeUrl) {
    initialDmText = `Hey @${username} 👋 Ye raha video link: ${youtubeUrl}\n\nPDF guide (${pdfTitle}) unlock karne ke liye:\n1️⃣ @${OWN_USERNAME} ko follow karo\n2️⃣ Phir neeche 'Followed ✅' dabao (ya reply mein DONE likho)`;
  } else {
    initialDmText = `Hey @${username} 👋 ${title} ki PDF guide + full video unlock karne ke liye:\n1️⃣ @${OWN_USERNAME} ko follow karo\n2️⃣ Phir neeche 'Followed ✅' dabao (ya reply mein DONE likho)`;
  }

  const publicReply = entry.replyComment || `@${username} DM check karo 📩`;

  return {
    action: 'GATE_FOLLOW',
    mediaId,
    commentId,
    username,
    igsid: from?.id,
    privateReply: {
      text: initialDmText,
      quick_replies: [
        {
          content_type: 'text',
          title: 'Followed ✅',
          payload: 'FOLLOWED'
        }
      ]
    },
    textOnlyFallback: {
      text: `${initialDmText}\n\n(Follow karke reply mein DONE likho)`
    },
    publicReply,
    pendingData: {
      mediaId,
      commentId,
      username,
      tries: 0,
      at: Date.now()
    }
  };
}

/**
 * Pure decision engine for messages events.
 */
export function decideMessageAction({ text, quickReplyPayload, pendingState, isFollowing, registryEntry, workerHost }) {
  // 1. Check if affirmative
  if (!isAffirmativeResponse(text, quickReplyPayload)) {
    return { action: 'IGNORE', reason: 'not_affirmative_response' };
  }

  // 2. Check if user had a pending check
  if (!pendingState) {
    return { action: 'IGNORE', reason: 'no_pending_check' };
  }

  // 3. If following is true -> deliver resources
  if (isFollowing === true) {
    const pdfSlug = registryEntry?.pdfSlug || registryEntry?.dm?.pdf?.slug;
    const pdfTitle = registryEntry?.pdfTitle || registryEntry?.dm?.pdf?.title || 'Resource Guide';
    const pdfUrl = pdfSlug ? `https://${workerHost}/pdf/${pdfSlug}` : null;
    const youtubeUrl = registryEntry?.youtubeUrl || registryEntry?.link || registryEntry?.dm?.link;

    const resourcesText = buildResourcesMessage({ pdfTitle, pdfUrl, youtubeUrl });
    return {
      action: 'DELIVER_RESOURCES',
      mediaId: pendingState.mediaId,
      messageText: resourcesText
    };
  }

  // 4. If not following -> ask again (max 3 tries)
  const currentTries = (pendingState.tries || 0) + 1;
  if (currentTries >= 3) {
    return {
      action: 'MAX_TRIES_EXCEEDED',
      mediaId: pendingState.mediaId
    };
  }

  const reminderText = `Abhi follow nahi dikh raha 🙂\n@${OWN_USERNAME} ko follow karke dobara 'Followed ✅' dabao (ya reply mein DONE likho)`;
  return {
    action: 'ASK_AGAIN',
    mediaId: pendingState.mediaId,
    newTries: currentTries,
    reply: {
      text: reminderText,
      quick_replies: [
        {
          content_type: 'text',
          title: 'Followed ✅',
          payload: 'FOLLOWED'
        }
      ]
    }
  };
}
