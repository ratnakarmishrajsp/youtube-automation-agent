// Auto-DM state (pending follow checks, delivered markers, poll progress, logs) lives in
// one SQLite-backed Durable Object instead of KV. KV's free plan allows 1,000 writes a
// day; on 22 Oct 2026 that ran out by 17:00 IST, pending records stopped saving and every
// "Followed ✅" after that was ignored. Durable Object storage allows 100,000 writes a day,
// and running the poll inside the object makes every read and write local.
//
// KV still serves the approved PDFs (`pdf:<slug>`); nothing else is written there.
import { DurableObject } from 'cloudflare:workers';
import { runPoll } from './poller.js';
import { processWebhookPayload } from './handlers.js';
import { storageKv } from './store.js';

// Keys copied from KV when the object starts, so nobody waiting loses their place.
// c: are old per-comment markers (no longer written) that still stop a repeat DM.
const IMPORT_PREFIXES = ['p:u:', 'p:id:', 'poll:', 'cfg:', 'd:', 'c:', 'm:'];
const IMPORT_KEY = 'meta:kv-import'; // { prefix, cursor, done, copied }
// A request may make 1,000 KV calls; stay well under it and continue on the next run.
const IMPORT_KEYS_PER_RUN = 400;
const PURGE_KEY = 'meta:last-purge';
const PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

// Copies the next batch of KV records. True once everything is in.
async function importFromKv(storage, kv) {
  const progress = (await storage.get(IMPORT_KEY)) || { prefix: 0, cursor: null, done: false, copied: 0 };
  if (progress.done || !kv) return true;
  let budget = IMPORT_KEYS_PER_RUN;
  while (progress.prefix < IMPORT_PREFIXES.length && budget > 0) {
    const page = await kv.list({ prefix: IMPORT_PREFIXES[progress.prefix], cursor: progress.cursor || undefined, limit: Math.min(budget, 1000) });
    for (const { name, expiration } of page.keys) {
      budget--;
      if (await storage.get(name)) continue; // the object already has a newer record
      const v = await kv.get(name);
      if (v === null) continue;
      await storage.put(name, { v, exp: expiration ? expiration * 1000 : 0 });
      progress.copied++;
    }
    if (page.list_complete) {
      progress.prefix++;
      progress.cursor = null;
    } else {
      progress.cursor = page.cursor;
    }
  }
  progress.done = progress.prefix >= IMPORT_PREFIXES.length;
  await storage.put(IMPORT_KEY, progress);
  console.log(JSON.stringify({ type: 'kv_import', ...progress }));
  return progress.done;
}

async function purgeExpired(storage) {
  const last = await storage.get(PURGE_KEY);
  if (last && Date.now() - Number(last.v) < PURGE_EVERY_MS) return;
  const all = await storage.list();
  const dead = [...all].filter(([, rec]) => rec && rec.exp && rec.exp < Date.now()).map(([k]) => k);
  for (let i = 0; i < dead.length; i += 128) await storage.delete(dead.slice(i, i + 128));
  await storage.put(PURGE_KEY, { v: String(Date.now()), exp: 0 });
}

export class AutoDmState extends DurableObject {
  stateEnv() {
    return { ...this.env, AUTO_DM: storageKv(this.ctx.storage) };
  }

  // Polling waits until the KV records are in: without the delivered markers a
  // repeat comment could get a second DM.
  async poll() {
    if (!await importFromKv(this.ctx.storage, this.env.AUTO_DM)) return;
    await runPoll(this.stateEnv());
    await purgeExpired(this.ctx.storage);
  }

  async webhook(rawBody, workerHost) {
    await importFromKv(this.ctx.storage, this.env.AUTO_DM);
    await processWebhookPayload(rawBody, this.stateEnv(), workerHost);
  }

  // Admin: copy the next KV batch now instead of waiting for the cron.
  async importNow() {
    await importFromKv(this.ctx.storage, this.env.AUTO_DM);
    return this.ctx.storage.get(IMPORT_KEY);
  }

  // Newest log events, for /stats.
  async recentLogs(limit = 50) {
    const kv = this.stateEnv().AUTO_DM;
    const { keys } = await kv.list({ prefix: 'log:' });
    const logs = [];
    for (const { name } of keys.slice(-20).reverse()) {
      const val = await kv.get(name, { type: 'json' });
      if (!val) continue;
      for (const ev of Array.isArray(val.batch) ? val.batch : [val]) logs.push({ key: name, ...ev });
      if (logs.length >= limit) break;
    }
    logs.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return logs.slice(0, limit);
  }

  // One key, for checking a customer from the CLI (/state?key=...&k=...).
  async peek(key) {
    return this.ctx.storage.get(key);
  }

  // Restore pending checks that were lost (admin endpoint): [{ username, data }].
  // An existing pending or delivered record always wins.
  async restorePending(records) {
    const kv = this.stateEnv().AUTO_DM;
    const restored = [];
    for (const { username, data } of records || []) {
      if (!username || !data?.mediaId) continue;
      if (await kv.get(`p:u:${username}`) || await kv.get(`d:${data.mediaId}:${username}`)) continue;
      await kv.put(`p:u:${username}`, JSON.stringify(data), { expirationTtl: 7 * 86400 });
      restored.push(username);
    }
    return restored;
  }
}

export function stateStub(env) {
  return env.AUTO_DM_STATE.get(env.AUTO_DM_STATE.idFromName('main'));
}
