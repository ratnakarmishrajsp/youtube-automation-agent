const test = require('node:test');
const assert = require('node:assert');

const { matchesKeyword } = require('../workers/auto-dm/src/flow.js');
const { runPoll } = require('../workers/auto-dm/src/poller.js');
const { resetRegistryCache } = require('../workers/auto-dm/src/handlers.js');

test.beforeEach(() => resetRegistryCache());

function memoryKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      if (!store.has(key)) return null;
      const v = store.get(key);
      return opts && opts.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, String(value)); },
    async delete(key) { store.delete(key); },
  };
}

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');

function fakeInstagram({ comments = [], conversations = [], follows = true, registry: customRegistry }) {
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
      return json({ id: `sent${sent.length}` });
    }
    if (url.includes('/me/media')) {
      const ids = [...new Set(registry.map((e) => e.mediaId))];
      return json({ data: ids.map((id) => ({ id, comments_count: comments.filter((c) => (c.media || 'M18') === id).length })) });
    }
    const mediaComments = url.match(/\/(M\w+)\/comments/);
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
  assert.match(privateReplies[0].body.message.text, /follow karo/);
  assert.ok(ig.sent.some((s) => s.url.includes('/C1/replies')), 'public reply posted');
  assert.ok(kv.store.has('p:id:U1'), 'pending follow check stored');

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
  assert.match(dms[0].body.message.text, /w\.example\/pdf\/claude-startups/);
  assert.match(dms[0].body.message.text, /youtu\.be\/x/);
  assert.ok(kv.store.has('d:M18:tester'));
  assert.ok(!kv.store.has('p:id:U1'));

  await kv.put('poll:state', JSON.stringify({ counts: {}, hw: {}, convAt: 0 }));
  await runPoll(env(kv));
  assert.strictEqual(ig.sent.filter((s) => s.body.recipient && s.body.recipient.id === 'U1').length, 1, 'not delivered twice');
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
