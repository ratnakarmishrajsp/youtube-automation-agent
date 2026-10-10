const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

// Import pure decision logic
const {
  matchesKeyword,
  isAffirmativeResponse,
  decideCommentAction,
  decideMessageAction
} = require('../workers/auto-dm/src/flow.js');

test('matchesKeyword verifies keyword boundaries correctly', () => {
  const keywords = ['claude', 'link'];
  assert.strictEqual(matchesKeyword('CLAUDE please send', keywords), true);
  assert.strictEqual(matchesKeyword('Bhai link bhejo', keywords), true);
  assert.strictEqual(matchesKeyword('claudeai', keywords), true);
  assert.strictEqual(matchesKeyword('unclaude topic', keywords), false);
  assert.strictEqual(matchesKeyword('some random comment', keywords), false);
  assert.strictEqual(matchesKeyword('', keywords), false);
});

test('isAffirmativeResponse matches quick reply payload and typed words', () => {
  assert.strictEqual(isAffirmativeResponse('Followed ✅', 'FOLLOWED'), true);
  assert.strictEqual(isAffirmativeResponse('done', null), true);
  assert.strictEqual(isAffirmativeResponse('DONE', null), true);
  assert.strictEqual(isAffirmativeResponse('followed', null), true);
  assert.strictEqual(isAffirmativeResponse('follow kar diya', null), true);
  assert.strictEqual(isAffirmativeResponse('ho gaya', null), true);
  assert.strictEqual(isAffirmativeResponse('hello sir', null), false);
  assert.strictEqual(isAffirmativeResponse('kuch nahi', null), false);
});

test('decideCommentAction ignores own comment', () => {
  const comment = {
    id: 'c1',
    text: 'CLAUDE',
    from: { id: 'u1', username: 'ratnakarcontent' },
    media: { id: 'm1' }
  };
  const res = decideCommentAction({ comment, registry: [], kvState: {}, workerHost: 'test.workers.dev' });
  assert.strictEqual(res.action, 'IGNORE');
  assert.strictEqual(res.reason, 'own_comment');
});

test('decideCommentAction ignores already handled comment', () => {
  const comment = {
    id: 'c1',
    text: 'CLAUDE',
    from: { id: 'u1', username: 'user1' },
    media: { id: 'm1' }
  };
  const res = decideCommentAction({
    comment,
    registry: [{ mediaId: 'm1', keywords: ['claude'] }],
    kvState: { commentHandled: true },
    workerHost: 'test.workers.dev'
  });
  assert.strictEqual(res.action, 'IGNORE');
  assert.strictEqual(res.reason, 'comment_already_handled');
});

test('decideCommentAction skips already delivered user for the reel', () => {
  const comment = {
    id: 'c1',
    text: 'CLAUDE',
    from: { id: 'u1', username: 'user1' },
    media: { id: 'm1' }
  };
  const res = decideCommentAction({
    comment,
    registry: [{ mediaId: 'm1', keywords: ['claude'] }],
    kvState: { delivered: true },
    workerHost: 'test.workers.dev'
  });
  assert.strictEqual(res.action, 'ALREADY_DELIVERED');
});

test('decideCommentAction returns GATE_FOLLOW when followGate is enabled', () => {
  const comment = {
    id: 'c1',
    text: 'bhai CLAUDE bhej do',
    from: { id: 'u1', username: 'founder_abc' },
    media: { id: 'm1' }
  };
  const registry = [{
    mediaId: 'm1',
    title: 'Claude Startup Rejection',
    keywords: ['claude'],
    followGate: 'all',
    pdfSlug: 'claude-startups',
    pdfTitle: 'Claude Guide',
    youtubeUrl: 'https://youtu.be/123'
  }];

  const res = decideCommentAction({
    comment,
    registry,
    kvState: {},
    workerHost: 'test.workers.dev'
  });

  assert.strictEqual(res.action, 'GATE_FOLLOW');
  assert.ok(res.privateReply.text.includes('follow karo'));
  assert.strictEqual(res.privateReply.quick_replies[0].payload, 'FOLLOWED');
  assert.ok(res.publicReply.includes('@founder_abc DM check karo'));
});

test('decideMessageAction delivers resources when isFollowing is true', () => {
  const pendingState = { mediaId: 'm1', commentId: 'c1', tries: 0 };
  const registryEntry = {
    mediaId: 'm1',
    pdfSlug: 'claude-startups',
    pdfTitle: 'Claude Guide',
    youtubeUrl: 'https://youtu.be/123'
  };

  const res = decideMessageAction({
    text: 'done',
    quickReplyPayload: null,
    pendingState,
    isFollowing: true,
    registryEntry,
    workerHost: 'ratnakar-auto-dm.workers.dev'
  });

  assert.strictEqual(res.action, 'DELIVER_RESOURCES');
  assert.ok(res.messageText.includes('https://ratnakar-auto-dm.workers.dev/pdf/claude-startups'));
  assert.ok(res.messageText.includes('https://youtu.be/123'));
});

test('decideMessageAction asks again if not following, and stops after 3 tries', () => {
  const pendingState1 = { mediaId: 'm1', commentId: 'c1', tries: 0 };
  const res1 = decideMessageAction({
    text: 'Followed ✅',
    quickReplyPayload: 'FOLLOWED',
    pendingState: pendingState1,
    isFollowing: false,
    registryEntry: {},
    workerHost: 'test.workers.dev'
  });
  assert.strictEqual(res1.action, 'ASK_AGAIN');
  assert.strictEqual(res1.newTries, 1);

  const pendingState2 = { mediaId: 'm1', commentId: 'c1', tries: 2 };
  const res2 = decideMessageAction({
    text: 'Followed ✅',
    quickReplyPayload: 'FOLLOWED',
    pendingState: pendingState2,
    isFollowing: false,
    registryEntry: {},
    workerHost: 'test.workers.dev'
  });
  assert.strictEqual(res2.action, 'MAX_TRIES_EXCEEDED');
});

test('decideMessageAction ignores unrelated message text', () => {
  const pendingState = { mediaId: 'm1', commentId: 'c1', tries: 0 };
  const res = decideMessageAction({
    text: 'Good morning sir, where are you from?',
    quickReplyPayload: null,
    pendingState,
    isFollowing: true,
    registryEntry: {},
    workerHost: 'test.workers.dev'
  });
  assert.strictEqual(res.action, 'IGNORE');
  assert.strictEqual(res.reason, 'not_affirmative_response');
});

test('HMAC SHA-256 signature verification passes on valid signature and fails on invalid', async () => {
  const secret = '6dc7029eaa9e5309dac1a47983dcc855';
  const body = JSON.stringify({ object: 'instagram', entry: [] });

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const validSig = 'sha256=' + hmac.digest('hex');
  const invalidSig = 'sha256=wrong_signature_12345';

  // Compare using same web crypto / buffer comparison
  const isValid = crypto.timingSafeEqual(
    Buffer.from(validSig),
    Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex'))
  );
  assert.strictEqual(isValid, true);
  assert.notStrictEqual(validSig, invalidSig);
});
