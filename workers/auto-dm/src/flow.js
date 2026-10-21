export const OWN_USERNAME = 'ratnakarcontent';
export const PROFILE_URL = `https://www.instagram.com/${OWN_USERNAME}/`;

const FOLLOWED_QUICK_REPLY = { content_type: 'text', title: 'Followed ✅', payload: 'FOLLOWED' };

// Follow-gate message with two buttons: "View Profile" opens the profile (no API
// can follow for the user), "Followed ✅" sends the FOLLOWED postback.
export function followGateButtons(text) {
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text,
        buttons: [
          { type: 'web_url', url: PROFILE_URL, title: 'View Profile 👤' },
          { type: 'postback', title: 'Followed ✅', payload: 'FOLLOWED' },
        ],
      },
    },
  };
}

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

// Instagram's one-tap emoji bar (🙌 🔥 ❤️ 👏 ...) makes emoji-only comments common on
// "Comment X" reels (21 Oct 2026: several 🙌 on the SKILL reel), so those count as asking.
const NEGATIVE_EMOJI = /👎|😡|🤬|🤮|💩|🖕|🙄|😒/u;
// Plain asks without the keyword: "send pls", "link chahiye" ("link" is already a keyword), "लिंक भेजो".
const REQUEST_WORDS = /(^|[^a-z0-9])(send|dm|pls|plz|please|chahiye|chaiye|chahie|bhejo|bhej|want|need|interested)([^a-z0-9]|$)|लिंक|चाहिए|भेजो/;

/**
 * True for a comment that asks for the resource without the keyword:
 * emoji-only (except negative emojis) or a request word.
 */
export function isRequestComment(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (!/[\p{L}\p{N}]/u.test(t)) return /\p{Extended_Pictographic}/u.test(t) && !NEGATIVE_EMOJI.test(t);
  return REQUEST_WORDS.test(t.toLowerCase());
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
export function buildResourcesMessage({ pdfTitle, pdfUrl, youtubeUrl, resourceLabel, lang }) {
  let msg = `✅ Thanks for following!\n\n`;
  if (pdfTitle && pdfUrl) {
    msg += `📄 ${pdfTitle}: ${pdfUrl}\n`;
  }
  if (youtubeUrl) {
    // resourceLabel: the link is not a video (e.g. a skill download)
    msg += resourceLabel ? `🔗 ${resourceLabel}: ${youtubeUrl}\n` : `📺 Full video: ${youtubeUrl}\n`;
  }
  msg += lang === 'en' ? `\nAny questions? Just reply here 🙂` : `\nKoi sawaal ho to yahin reply karo 🙂`;
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
  if (!matchesKeyword(text, keywords) && !isRequestComment(text)) {
    return { action: 'IGNORE', reason: 'keyword_mismatch' };
  }

  // 5. Check if user was already delivered resources for this reel
  if (kvState?.delivered) {
    return { action: 'ALREADY_DELIVERED', reason: 'already_delivered_for_media' };
  }
  // People often send "🙌" and "SKILL" seconds apart: one DM for both is enough.
  if (kvState?.pending) {
    return { action: 'IGNORE', reason: 'already_pending_for_media' };
  }

  const followGate = entry.followGate || 'none';
  const pdfSlug = entry.pdfSlug || entry.dm?.pdf?.slug;
  const pdfTitle = entry.pdfTitle || entry.dm?.pdf?.title || 'Resource Guide';
  const pdfUrl = pdfSlug ? `https://${workerHost}/pdf/${pdfSlug}` : null;
  const youtubeUrl = entry.youtubeUrl || entry.link || entry.dm?.link;
  // Entries with lang "en" get English DMs (universal audience, 21 Oct 2026); others stay Hinglish.
  const en = entry.lang === 'en';
  const { resourceLabel } = entry;
  const defaultPublicReply = en ? `@${username} Check your DMs 📩` : `@${username} DM check karo 📩`;

  // If followGate === "none", deliver immediately
  if (followGate === 'none') {
    const resourcesMsg = entry.dmMessage || buildResourcesMessage({ pdfTitle, pdfUrl, youtubeUrl, resourceLabel, lang: entry.lang });
    const replyComment = entry.replyComment || defaultPublicReply;
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
  if (en && followGate === 'pdf' && youtubeUrl) {
    initialDmText = `Hey @${username} 👋 Here's the ${resourceLabel || 'link'}: ${youtubeUrl}\n\nTo unlock the PDF guide (${pdfTitle}):\n1️⃣ Tap 'View Profile' and follow @${OWN_USERNAME}\n2️⃣ Come back and tap 'Followed ✅' (or reply DONE)`;
  } else if (en) {
    initialDmText = `Hey @${username} 👋 Want the ${resourceLabel || title}?\n1️⃣ Tap 'View Profile' and follow @${OWN_USERNAME}\n2️⃣ Come back and tap 'Followed ✅' (or reply DONE)`;
  } else if (followGate === 'pdf' && youtubeUrl) {
    initialDmText = `Hey @${username} 👋 Ye raha video link: ${youtubeUrl}\n\nPDF guide (${pdfTitle}) unlock karne ke liye:\n1️⃣ 'View Profile' dabao aur @${OWN_USERNAME} ko follow karo\n2️⃣ Wapas aake 'Followed ✅' dabao (ya reply mein DONE likho)`;
  } else {
    initialDmText = `Hey @${username} 👋 ${title} ki PDF guide + full video unlock karne ke liye:\n1️⃣ 'View Profile' dabao aur @${OWN_USERNAME} ko follow karo\n2️⃣ Wapas aake 'Followed ✅' dabao (ya reply mein DONE likho)`;
  }

  const publicReply = entry.replyComment || defaultPublicReply;

  return {
    action: 'GATE_FOLLOW',
    mediaId,
    commentId,
    username,
    igsid: from?.id,
    privateReply: followGateButtons(initialDmText),
    quickReplyFallback: { text: initialDmText, quick_replies: [FOLLOWED_QUICK_REPLY] },
    textOnlyFallback: {
      text: `${initialDmText}\n\n${en ? '(After following, reply DONE)' : '(Follow karke reply mein DONE likho)'}`
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

    const resourcesText = buildResourcesMessage({
      pdfTitle, pdfUrl, youtubeUrl, resourceLabel: registryEntry?.resourceLabel, lang: registryEntry?.lang,
    });
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

  const reminderText = registryEntry?.lang === 'en'
    ? `I can't see your follow yet 🙂\nTap 'View Profile', follow @${OWN_USERNAME}, then tap 'Followed ✅' again (or reply DONE)`
    : `Abhi follow nahi dikh raha 🙂\n'View Profile' dabao, @${OWN_USERNAME} ko follow karo, phir dobara 'Followed ✅' dabao (ya reply mein DONE likho)`;
  return {
    action: 'ASK_AGAIN',
    mediaId: pendingState.mediaId,
    newTries: currentTries,
    reply: followGateButtons(reminderText),
    replyFallback: { text: reminderText, quick_replies: [FOLLOWED_QUICK_REPLY] }
  };
}
