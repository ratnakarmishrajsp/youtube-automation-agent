const test = require('node:test');
const assert = require('node:assert');

const { matchesKeyword } = require('../workers/auto-dm/src/flow.js');
const { runPoll, resetPollMemory } = require('../workers/auto-dm/src/poller.js');
const { resetRegistryCache } = require('../workers/auto-dm/src/handlers.js');

// A fresh isolate: no poll state, registry, pending/delivered fallbacks or buffered logs in memory.
function coldStart() {
  resetRegistryCache();
  resetPollMemory();
}
test.beforeEach(coldStart);

function memoryKv({ refuseWrites = false } = {}) {
  const store = new Map();
  const writes = [];
  return {
    store,
    writes,
    async get(key, opts) {
      if (!store.has(key)) return null;
      const v = store.get(key);
      return opts && opts.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      if (refuseWrites) throw new Error('KV put() limit exceeded for the day.');
      writes.push(key);
      store.set(key, String(value));
    },
    async delete(key) { store.delete(key); },
  };
}

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');

function fakeInstagram({ comments = [], conversations = [], follows = true, registry: customRegistry, sendError = null }) {
  const sent = [];
  const registry = customRegistry || [{
    queueId: 18, mediaId: 'M18', title: 'Claude Startups', keywords: ['claude', 'link'],
    youtubeUrl: 'https://youtu.be/x', followGate: 'all', pdfSlug: 'claude-startups', pdfTitle: 'Apply Guide',
    publishedAt: new Date(NOW - 3600e3).toISOString(),
  }];
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    const json = (data) => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });
    if (url.includes('raw.githubusercontent.com')) return json(registry);
    if (init.method === 'POST') {
      sent.push({ url, body: JSON.parse(init.body) });
      if (sendError && url.includes('/me/messages')) return json({ error: sendError });
      return json({ id: `sent${sent.length}` });
    }
    if (url.includes('/me/media')) {
      const ids = [...new Set(registry.map((e) => e.mediaId))];
      return json({ data: ids.map((id) => ({ id, comments_count: comments.filter((c) => (c.media || 'M18') === id).length })) });
    }
    const mediaComments = url.match(/\/([A-Za-z0-9]+)\/comments/);
    if (mediaComments) return json({ data: comments.filter((c) => (c.media || 'M18') === mediaComments[1]) });
    if (url.includes('/me/conversations')) return json({ data: conversations });
    if (url.includes('is_user_follow_business')) return json({ username: 'tester', is_user_follow_business: follows });
    throw new Error(`unexpected fetch ${url}`);
  };
  return { sent };
}

function env(kv) {
  return { AUTO_DM: kv, IG_ACCESS_TOKEN: 'tok', WORKER_HOST: 'w.example' };
}

test('matchesKeyword tolerates one-letter typos on long keywords only', () => {
  assert.strictEqual(matchesKeyword('Calude', ['claude']), true);
  assert.strictEqual(matchesKeyword('cluade bhai', ['claude']), true);
  assert.strictEqual(matchesKeyword('emotion', ['remotion']), false);
  assert.strictEqual(matchesKeyword('like', ['link']), false);
  assert.strictEqual(matchesKeyword('great video', ['claude', 'link']), false);
});

test('poller sends the follow instructions once for a typo comment', async () => {
  const kv = memoryKv();
  const comments = [{ id: 'C1', text: 'Calude', timestamp: iso(NOW - 60e3), from: { id: 'U1', username: 'tester' } }];
  const ig = fakeInstagram({ comments });

  await runPoll(env(kv));
  const privateReplies = ig.sent.filter((s) => s.body.recipient && s.body.recipient.comment_id === 'C1');
  assert.strictEqual(privateReplies.length, 1);
  assert.match(privateReplies[0].body.message.attachment.payload.text, /follow karo/);
  assert.ok(ig.sent.some((s) => s.url.includes('/C1/replies')), 'public reply posted');
  assert.ok(kv.store.has('p:u:tester'), 'pending follow check stored');

  await runPoll(env(kv));
  assert.strictEqual(ig.sent.filter((s) => s.body.recipient && s.body.recipient.comment_id === 'C1').length, 1, 'no second DM');
});

test('poller delivers PDF + video once after a "Done" reply from a follower', async () => {
  const kv = memoryKv();
  await kv.put('p:id:U1', JSON.stringify({ mediaId: 'M18', commentId: 'C1', username: 'tester', tries: 0, at: NOW - 120e3 }));
  const conversations = [{
    updated_time: iso(NOW - 30e3),
    participants: { data: [{ id: 'OWN', username: 'ratnakarcontent' }, { id: 'U1', username: 'tester' }] },
    messages: { data: [{ id: 'MID1', message: 'Done', created_time: iso(NOW - 30e3), from: { id: 'U1', username: 'tester' } }] },
  }];
  const ig = fakeInstagram({ conversations, follows: true });

  await runPoll(env(kv));
  const dms = ig.sent.filter((s) => s.body.recipient && s.body.recipient.id === 'U1');
  assert.strictEqual(dms.length, 1);
  assert.match(dms[0].body.message.text, /w\.example\/guide\/claude-startups/);
  assert.match(dms[0].body.message.text, /youtu\.be\/x/);
  assert.ok(kv.store.has('d:M18:tester'));
  assert.ok(!kv.store.has('p:id:U1'));

  // Cold start with old saved marks: the same "Done" is read again.
  await kv.put('poll:state', JSON.stringify({ counts: {}, hw: {}, convAt: 0 }));
  coldStart();
  await runPoll(env(kv));
  assert.strictEqual(ig.sent.filter((s) => s.body.recipient && s.body.recipient.id === 'U1').length, 1, 'not delivered twice');
});

test('a follow-gate DM persists progress so a cold cron isolate does not replay it', async () => {
  const kv = memoryKv();
  const comments = [{ id: 'C1', text: 'Claude', timestamp: iso(NOW - 60e3), from: { id: 'U1', username: 'tester' } }];
  const ig = fakeInstagram({ comments });
  for (let i = 0; i < 5; i++) await runPoll(env(kv));
  assert.strictEqual(ig.sent.filter((s) => s.body.recipient && s.body.recipient.comment_id === 'C1').length, 1);
  assert.ok(kv.store.has('poll:state'));
  assert.ok(kv.store.has('p:u:tester'));
  coldStart();
  await runPoll(env(kv));
  assert.strictEqual(ig.sent.filter((s) => s.body.recipient?.comment_id === 'C1').length, 1);
});

test('a cold start re-reads the same comment and sends nothing new', async () => {
  const kv = memoryKv();
  const comments = [{ id: 'C1', text: 'Claude', timestamp: iso(NOW - 60e3), from: { id: 'U1', username: 'tester' } }];
  const ig = fakeInstagram({ comments });
  await runPoll(env(kv));
  coldStart();
  await runPoll(env(kv));
  assert.strictEqual(ig.sent.filter((s) => s.body.recipient && s.body.recipient.comment_id === 'C1').length, 1);
});

test('when KV refuses writes (daily limit) the DM still goes out, once', async () => {
  const kv = memoryKv({ refuseWrites: true });
  const comments = [{ id: 'C1', text: 'Claude', timestamp: iso(NOW - 60e3), from: { id: 'U1', username: 'tester' } }];
  const ig = fakeInstagram({ comments });
  await runPoll(env(kv));
  await runPoll(env(kv));
  assert.strictEqual(ig.sent.filter((s) => s.body.recipient && s.body.recipient.comment_id === 'C1').length, 1);
});

test('poll state and a compact log batch reach KV after the run', async () => {
  const kv = memoryKv();
  const comments = [{ id: 'C1', text: 'Claude', timestamp: iso(NOW - 60e3), from: { id: 'U1', username: 'tester' } }];
  fakeInstagram({ comments });
  await runPoll(env(kv));
  assert.ok(kv.store.has('poll:state'));
  const logKeys = [...kv.store.keys()].filter((k) => k.startsWith('log:'));
  assert.strictEqual(logKeys.length, 1);
  assert.ok(JSON.parse(kv.store.get(logKeys[0])).batch.some((e) => e.type === 'follow_gate_sent'));
});

test('poller ignores a "Done" that was sent before the follow instructions', async () => {
  const kv = memoryKv();
  await kv.put('p:id:U1', JSON.stringify({ mediaId: 'M18', username: 'tester', tries: 0, at: NOW - 10e3 }));
  const conversations = [{
    updated_time: iso(NOW - 5e3),
    participants: { data: [{ id: 'U1', username: 'tester' }] },
    messages: { data: [{ id: 'OLD', message: 'Done', created_time: iso(NOW - 600e3), from: { id: 'U1' } }] },
  }];
  const ig = fakeInstagram({ conversations });
  await runPoll(env(kv));
  assert.strictEqual(ig.sent.length, 0);
});

test('emoji-only comments get the DM; "🙌" then "Claude" from one user gets only one', async () => {
  const kv = memoryKv();
  const comments = [
    { id: 'E1', text: '🙌', timestamp: iso(NOW - 50e3), from: { id: 'U5', username: 'double_tap' } },
    { id: 'E2', text: 'Claude', timestamp: iso(NOW - 45e3), from: { id: 'U5', username: 'double_tap' } },
    { id: 'E3', text: '🔥', timestamp: iso(NOW - 40e3), from: { id: 'U6', username: 'fire_fan' } },
    { id: 'E4', text: 'great video', timestamp: iso(NOW - 30e3), from: { id: 'U7', username: 'just_praise' } },
  ];
  const ig = fakeInstagram({ comments });
  await runPoll(env(kv));
  const repliedTo = ig.sent.filter((s) => s.body.recipient && s.body.recipient.comment_id).map((s) => s.body.recipient.comment_id);
  assert.deepStrictEqual(repliedTo, ['E1', 'E3']);
});

test('a reel published 2 months ago still auto-DMs a fresh comment; old legacy reels and old comments are skipped', async () => {
  const kv = memoryKv();
  const twoMonthsAgo = new Date(NOW - 60 * 864e5).toISOString();
  const registry = [
    { queueId: 30, mediaId: 'MNEW', title: 'New system reel', keywords: ['claude'], youtubeUrl: 'https://youtu.be/n', followGate: 'all', publishedAt: twoMonthsAgo },
    { queueId: 3, mediaId: 'MOLD', title: 'Legacy reel', keywords: ['claude'], youtubeUrl: 'https://youtu.be/o', publishedAt: twoMonthsAgo },
  ];
  const comments = [
    { media: 'MNEW', id: 'FRESH', text: 'CLAUDE', timestamp: iso(NOW - 60e3), from: { id: 'U2', username: 'late_fan' } },
    { media: 'MNEW', id: 'STALE', text: 'CLAUDE', timestamp: iso(NOW - 8 * 864e5), from: { id: 'U3', username: 'too_late' } },
    { media: 'MOLD', id: 'LEGACY', text: 'CLAUDE', timestamp: iso(NOW - 60e3), from: { id: 'U4', username: 'old_reel_fan' } },
  ];
  const ig = fakeInstagram({ comments, registry });
  await runPoll(env(kv));
  const repliedTo = ig.sent.filter((s) => s.body.recipient && s.body.recipient.comment_id).map((s) => s.body.recipient.comment_id);
  assert.deepStrictEqual([...new Set(repliedTo)], ['FRESH']);
});

test('both recent reels deliver the resource in the first private reply, including the Shopify PDF', async () => {
  const kv = memoryKv();
  const registry = require('../data/auto_dm_registry.json').filter((r) => [27, 28].includes(r.queueId));
  const comments = registry.map((r, i) => ({
    media: r.mediaId, id: `DIRECT${i}`, text: r.keywords[0],
    timestamp: iso(NOW - 60e3 + i * 1000), from: { id: `U${i}`, username: `fan${i}` },
  }));
  const ig = fakeInstagram({ comments, registry });
  await runPoll(env(kv));
  const privateReplies = ig.sent.filter((s) => s.body.recipient?.comment_id);
  assert.strictEqual(privateReplies.length, 2);
  assert.match(privateReplies.find((s) => s.body.recipient.comment_id === 'DIRECT0').body.message.text, /ratnakar-meta-ads-skill/);
  const shopifyMessage = privateReplies.find((s) => s.body.recipient.comment_id === 'DIRECT1').body.message.text;
  assert.match(shopifyMessage, /guide\/claude-shopify-setup/);
  assert.match(shopifyMessage, /pdf\/claude-shopify-setup/);
  assert.ok(kv.store.has(`d:${registry[0].mediaId}:fan0`));
  assert.ok(kv.store.has(`d:${registry[1].mediaId}:fan1`));
});

test('Meta spam limit pauses the poll instead of trying three private reply variants', async () => {
  const kv = memoryKv();
  const comments = [{ id: 'RATE1', text: 'Claude', timestamp: iso(NOW - 60e3), from: { id: 'U1', username: 'fan' } }];
  const ig = fakeInstagram({ comments, sendError: { code: 4, message: 'We limit how often you can post' } });
  await runPoll(env(kv));
  assert.strictEqual(ig.sent.filter((s) => s.body.recipient?.comment_id === 'RATE1').length, 1);
  assert.ok(Number(kv.store.get('poll:rate-limit-until')) > Date.now());
  await runPoll(env(kv));
  assert.strictEqual(ig.sent.filter((s) => s.body.recipient?.comment_id === 'RATE1').length, 1);
});

test('an old follow-prompt recipient on a direct-resource reel gets the guide after any new reply', async () => {
  const kv = memoryKv();
  const registry = require('../data/auto_dm_registry.json').filter((r) => r.queueId === 28);
  const mediaId = registry[0].mediaId;
  await kv.put('p:u:fan', JSON.stringify({ mediaId, commentId: 'OLD1', username: 'fan', tries: 0, at: NOW - 120e3 }));
  // The previous worker could move this watermark past a failed second DM.
  await kv.put('poll:state', JSON.stringify({ counts: {}, hw: {}, convAt: NOW + 60e3 }));
  const conversations = [{
    updated_time: iso(NOW - 30e3),
    participants: { data: [{ id: 'OWN', username: 'ratnakarcontent' }, { id: 'U1', username: 'fan' }] },
    messages: { data: [{ id: 'MID1', message: 'hi', created_time: iso(NOW - 30e3), from: { id: 'U1' } }] },
  }];
  const ig = fakeInstagram({ conversations, registry, follows: false });
  await runPoll(env(kv));
  const delivered = ig.sent.filter((s) => s.body.recipient?.id === 'U1');
  assert.strictEqual(delivered.length, 1);
  assert.match(delivered[0].body.message.text, /pdf\/claude-shopify-setup/);
  assert.ok(kv.store.has(`d:${mediaId}:fan`));
  assert.ok(!kv.store.has('p:u:fan'));
});
