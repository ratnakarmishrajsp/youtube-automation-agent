// Publishes due reels from data/instagram_reels_queue.json.
//
// Runs in two places: the Windows task "Instagram_Reels_Auto_Queue" (every 10 min)
// and the GitHub Actions workflow. Both may see the same reel, so every publish is
// guarded by (1) a live-feed caption check, (2) the container's own status, and
// (3) a re-check right before media_publish.
//
//   node scripts/instagram-auto-scheduler.js                 normal check
//   node scripts/instagram-auto-scheduler.js --force 18      publish reel 18 now
//   node scripts/instagram-auto-scheduler.js --dry-run       show what would happen
//   node scripts/instagram-auto-scheduler.js --wait-window 300
//        if the next reel is due within 300 min, wait and publish it on time
//   node scripts/instagram-auto-scheduler.js --grace 2       publish 2 min after due time
try {
  require('dotenv').config();
} catch {
  // dotenv is optional in CI, where secrets come from the environment
}
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const fs = require('fs');
const path = require('path');
const ig = require('./lib/instagram');
const { registerPublishedReel } = require('./lib/dm-registry');

const LOG_FILE = path.join(ig.ROOT, 'logs', 'instagram_scheduler.log');
const LOCK_FILE = path.join(ig.ROOT, 'data', 'instagram_scheduler.lock');
const LOCK_STALE_MS = 30 * 60 * 1000;
const PROCESSING_STALE_MS = 20 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const IN_CLOUD = process.env.GITHUB_ACTIONS === 'true';
const FALLBACK_PERMALINK = 'https://www.instagram.com/ratnakarcontent/reels/';

function log(msg) {
  console.log(msg);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // logging must never stop a publish
  }
}

// ==========================================
// PROCESS LOCK — exclusive create, released only by its owner
// ==========================================
let ownsLock = false;

function lockPayload() {
  return JSON.stringify({ pid: process.pid, timestamp: Date.now(), host: IN_CLOUD ? 'github-actions' : 'local' });
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(LOCK_FILE, lockPayload(), { flag: 'wx' });
      ownsLock = true;
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') {
        log(`❌ Could not create lock file: ${e.message}`);
        return false;
      }
    }
    let lock = null;
    try {
      lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    } catch {
      // unreadable lock counts as stale
    }
    const age = lock ? Date.now() - lock.timestamp : Infinity;
    if (age < LOCK_STALE_MS) {
      log(`⛔ Another publisher (PID ${lock.pid}) is active (${Math.round(age / 1000)}s old). Exiting to prevent duplicate uploads.`);
      return false;
    }
    log(`⚠️ Removing stale lock from PID ${lock ? lock.pid : '?'}.`);
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      // another process removed it first; the next wx attempt decides
    }
  }
  return false;
}

function refreshLock() {
  if (!ownsLock) return;
  try {
    fs.writeFileSync(LOCK_FILE, lockPayload());
  } catch {
    // a missed heartbeat only risks the lock looking stale later
  }
}

function releaseLock() {
  if (!ownsLock) return;
  ownsLock = false;
  try {
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (lock.pid === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {
    // lock already gone
  }
}

process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

async function sleepWithHeartbeat(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await ig.sleep(Math.min(60000, end - Date.now()));
    refreshLock();
  }
}

// ==========================================
// QUEUE HELPERS
// ==========================================

// Re-read the file and replace just this reel, so a reel added by another
// script while we were busy is not overwritten.
function saveReel(reel) {
  const queue = ig.readJson(ig.QUEUE_PATH, []);
  const idx = queue.findIndex((r) => r.id === reel.id);
  if (idx === -1) queue.push(reel);
  else queue[idx] = reel;
  ig.writeJson(ig.QUEUE_PATH, queue);
}

function isPending(reel) {
  if (reel.status === 'READY_TO_PUBLISH' || reel.status === 'QUEUED') return true;
  if (reel.status === 'PROCESSING') {
    // A run that crashed mid-publish leaves PROCESSING behind; retry it after a while.
    const started = Date.parse(reel.processingStartedAt || 0) || 0;
    return Date.now() - started > PROCESSING_STALE_MS;
  }
  return false;
}

function markPublished(reel, mediaId, permalink, publishedAt) {
  reel.status = 'PUBLISHED';
  reel.publishedMediaId = mediaId;
  reel.permalink = permalink || FALLBACK_PERMALINK;
  reel.publishedAt = publishedAt || new Date().toISOString();
  delete reel.processingStartedAt;
  delete reel.lastError;
  delete reel.lastErrorAt;
  saveReel(reel);
  try {
    if (registerPublishedReel(reel)) log(`🔗 Auto-DM registry updated for Reel #${reel.id}`);
  } catch (e) {
    log(`⚠️ Could not update auto-DM registry: ${e.message}`);
  }
}

// ==========================================
// PUBLISHING
// ==========================================

// The container says PUBLISHED: someone (the other publisher) already posted it.
async function resolvePublishedContainer(reel) {
  log(`ℹ️ Container ${reel.containerId} is already PUBLISHED. Looking for the post on the feed...`);
  for (let i = 0; i < 3; i++) {
    await ig.sleep(10000);
    const live = await ig.findLiveMatch(reel);
    if (live) return live;
  }
  reel.status = 'NEEDS_REVIEW';
  throw new Error(`Container ${reel.containerId} is PUBLISHED but the post is not on the feed. Check Instagram manually, then set status back to READY_TO_PUBLISH if it is really missing.`);
}

// Returns a media id if the stored container could be published, else null.
async function tryExistingContainer(reel) {
  let status;
  try {
    status = await ig.containerStatus(reel.containerId);
  } catch (e) {
    log(`⚠️ Could not read container ${reel.containerId}: ${e.message}`);
    return null;
  }
  log(`📊 Existing container ${reel.containerId}: ${status}`);

  if (status === 'PUBLISHED') return (await resolvePublishedContainer(reel)).id;
  if (status === 'IN_PROGRESS') {
    try {
      status = await ig.waitForContainer(reel.containerId, { log });
    } catch (e) {
      log(`⚠️ ${e.message}`);
      return null;
    }
  }
  if (status !== 'FINISHED') return null;

  try {
    return await ig.publishContainer(reel.containerId);
  } catch (e) {
    log(`⚠️ media_publish with existing container failed: ${e.message}`);
    const after = await ig.containerStatus(reel.containerId).catch(() => null);
    if (after === 'PUBLISHED') return (await resolvePublishedContainer(reel)).id;
    return null;
  }
}

function localFile(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(ig.ROOT, p);
}

async function freshContainer(reel) {
  const videoFile = localFile(reel.localVideoPath);
  const coverFile = localFile(reel.localCoverPath);
  const hasFile = (f) => f && fs.existsSync(f);

  let videoUrl = reel.videoUrl || ig.uploadToCdn(videoFile, log);
  let coverUrl = reel.coverUrl || (hasFile(coverFile) ? ig.uploadToCdn(coverFile, log) : null);

  log(`📦 Creating fresh container for Reel #${reel.id}...`);
  let containerId;
  try {
    containerId = await ig.createReelContainer({ videoUrl, coverUrl, caption: reel.caption });
  } catch (e) {
    // The stored CDN link may have expired; re-upload once if the file is on this machine.
    if (!reel.videoUrl || !hasFile(videoFile)) throw e;
    log(`⚠️ ${e.message} — re-uploading media and retrying once.`);
    videoUrl = ig.uploadToCdn(videoFile, log);
    if (hasFile(coverFile)) coverUrl = ig.uploadToCdn(coverFile, log);
    containerId = await ig.createReelContainer({ videoUrl, coverUrl, caption: reel.caption });
  }
  log(`✅ Container created: ${containerId}. Waiting for Meta to process...`);
  await ig.waitForContainer(containerId, { log });

  reel.containerId = containerId;
  reel.videoUrl = videoUrl;
  reel.coverUrl = coverUrl;
  saveReel(reel);
  return containerId;
}

async function publishSingleReel(reel, { dryRun }) {
  log(`\n====================================================`);
  log(`🚀 PUBLISHING REEL #${reel.id}: "${reel.title}"`);
  log(`⏰ Target time: ${reel.scheduledTimeIST || reel.scheduledAtUTC}`);
  log(`====================================================`);

  if (dryRun) {
    const live = await ig.findLiveMatch(reel);
    log(live ? `[dry-run] Already live: ${live.permalink}` : `[dry-run] Would publish now (container ${reel.containerId || 'new'}).`);
    return false;
  }

  reel.status = 'PROCESSING';
  reel.processingStartedAt = new Date().toISOString();
  reel.attempts = (reel.attempts || 0) + 1;
  saveReel(reel);

  try {
    const live = await ig.findLiveMatch(reel);
    if (live) {
      log(`🛑 Already live on Instagram: ${live.permalink}. Marking as published, no re-upload.`);
      markPublished(reel, live.id, live.permalink, live.timestamp);
      return true;
    }

    let mediaId = reel.containerId ? await tryExistingContainer(reel) : null;
    if (!mediaId) {
      const containerId = await freshContainer(reel);
      const liveNow = await ig.findLiveMatch(reel);
      if (liveNow) {
        log(`🛑 Another publisher posted it while we were processing: ${liveNow.permalink}`);
        markPublished(reel, liveNow.id, liveNow.permalink, liveNow.timestamp);
        return true;
      }
      log(`🚀 media_publish with container ${containerId}...`);
      mediaId = await ig.publishContainer(containerId);
    }

    const permalink = await ig.permalinkFor(mediaId);
    markPublished(reel, mediaId, permalink);
    log(`✅ REEL #${reel.id} IS LIVE: ${reel.permalink} (media ${mediaId})`);
    return true;
  } catch (err) {
    reel.lastError = err.message;
    reel.lastErrorAt = new Date().toISOString();
    if (reel.status !== 'NEEDS_REVIEW') {
      reel.status = reel.attempts >= MAX_ATTEMPTS ? 'FAILED' : 'READY_TO_PUBLISH';
    }
    saveReel(reel);
    log(`❌ Reel #${reel.id} not published (attempt ${reel.attempts}/${MAX_ATTEMPTS}, now ${reel.status}): ${err.message}`);
    throw err;
  }
}

async function processDue({ forceId, graceMs, dryRun }) {
  const queue = ig.readJson(ig.QUEUE_PATH, null);
  if (!queue) {
    log(`⚠️ Queue file not found: ${ig.QUEUE_PATH}`);
    return { failures: 0, queue: [] };
  }

  let failures = 0;
  for (const reel of queue) {
    if (forceId !== null) {
      if (reel.id !== forceId) continue;
      if (reel.status === 'PUBLISHED') {
        log(`ℹ️ Reel #${reel.id} is already PUBLISHED: ${reel.permalink}`);
        continue;
      }
    } else {
      if (!isPending(reel)) continue;
      const at = ig.parseScheduleTime(reel);
      if (Number.isNaN(at)) {
        log(`⚠️ Reel #${reel.id} has an unreadable schedule time "${reel.scheduledTimeIST}". Skipping.`);
        continue;
      }
      if (Date.now() < at + graceMs) continue;
      log(`⏰ Reel #${reel.id} due (scheduled ${ig.formatIST(at)} IST).`);
    }

    try {
      await publishSingleReel(reel, { dryRun });
    } catch {
      failures++;
    }
  }
  return { failures, queue: ig.readJson(ig.QUEUE_PATH, []) };
}

function nextDueTime(queue, graceMs) {
  const times = queue
    .filter(isPending)
    .map(ig.parseScheduleTime)
    .filter((t) => !Number.isNaN(t) && t + graceMs > Date.now());
  return times.length ? Math.min(...times) : null;
}

function parseArgs(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : undefined;
  };
  return {
    daemon: argv.includes('--daemon'),
    dryRun: argv.includes('--dry-run'),
    forceId: value('--force') ?? null,
    // Local runs wait up to 10 min and publish 2 min late, so an on-time cloud
    // run gets there first and the laptop only acts as a backup.
    waitWindowMin: value('--wait-window') ?? (IN_CLOUD ? 0 : 10),
    graceMin: value('--grace') ?? (IN_CLOUD ? 0 : 2),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const graceMs = args.graceMin * 60000;

  if (!acquireLock()) return;

  try {
    ig.credentials();
    if (args.forceId !== null) {
      log(`⚡ Force publishing Reel #${args.forceId}...`);
      const { failures } = await processDue({ forceId: args.forceId, graceMs, dryRun: args.dryRun });
      if (failures) process.exitCode = 1;
      return;
    }

    if (args.daemon) {
      log(`🔄 Instagram scheduler daemon active, checking every 60 seconds...`);
      for (;;) {
        await processDue({ forceId: null, graceMs, dryRun: args.dryRun });
        await sleepWithHeartbeat(60000);
      }
    }

    log(`🔍 Checking Instagram Reels Queue...`);
    let { failures, queue } = await processDue({ forceId: null, graceMs, dryRun: args.dryRun });

    const next = nextDueTime(queue, graceMs);
    const waitMs = next === null ? null : next + graceMs - Date.now();
    if (waitMs !== null && waitMs <= args.waitWindowMin * 60000) {
      log(`⏳ Next reel due at ${ig.formatIST(next)} IST. Waiting ${Math.ceil(waitMs / 60000)} min to publish on time...`);
      await sleepWithHeartbeat(waitMs);
      failures += (await processDue({ forceId: null, graceMs, dryRun: args.dryRun })).failures;
    }

    const upcoming = nextDueTime(ig.readJson(ig.QUEUE_PATH, []), graceMs);
    log(upcoming === null ? `🏁 Queue check complete. Nothing pending.` : `🏁 Queue check complete. Next pending: ${ig.formatIST(upcoming)} IST.`);
    if (failures) process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

main().catch((err) => {
  log(`💥 Fatal error: ${err.message}`);
  releaseLock();
  process.exit(1);
});
