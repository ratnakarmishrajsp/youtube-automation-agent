// The laptop and the GitHub Actions publisher both edit the queue and the DM
// registry, so a plain `git pull` conflicts. This merges the two JSON files
// record by record and pushes the result.
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, QUEUE_PATH, REGISTRY_PATH, readJson, writeJson } = require('./instagram');

const FILES = [QUEUE_PATH, REGISTRY_PATH].map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
const STATUS_RANK = { PUBLISHED: 5, NEEDS_REVIEW: 4, FAILED: 3, PROCESSING: 2, READY_TO_PUBLISH: 1, QUEUED: 1 };

// Per reel id, keep whichever copy is further along (PUBLISHED wins); on a tie keep the cloud copy.
function mergeQueues(local, remote) {
  const byId = new Map(remote.map((r) => [r.id, r]));
  for (const reel of local) {
    const other = byId.get(reel.id);
    if (!other || (STATUS_RANK[reel.status] || 0) > (STATUS_RANK[other.status] || 0)) byId.set(reel.id, reel);
  }
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

const registryKey = (e) => (e.queueId ? `q${e.queueId}` : e.mediaId ? `m${e.mediaId}` : `t${e.title}`);

// Local edits win field by field, but a media ID found by either side is never lost.
function mergeRegistries(local, remote) {
  const merged = new Map(remote.map((e) => [registryKey(e), e]));
  for (const entry of local) {
    const key = registryKey(entry);
    const other = merged.get(key);
    if (!other) {
      merged.set(key, entry);
      continue;
    }
    const combined = { ...other, ...entry };
    if (!entry.mediaId && other.mediaId) {
      combined.mediaId = other.mediaId;
      combined.permalink = other.permalink;
      combined.publishedAt = other.publishedAt;
    }
    merged.set(key, combined);
  }
  return [...merged.values()];
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'] });
}

// Fetch, merge local changes onto the latest cloud versions, commit and push.
function syncAndPush(message, log = console.log) {
  const localQueue = readJson(QUEUE_PATH, []);
  const localRegistry = readJson(REGISTRY_PATH, []);

  for (let attempt = 1; attempt <= 3; attempt++) {
    git(['fetch', 'origin', 'master']);
    // Our versions are held in memory; drop the working copies so the pull cannot conflict on them.
    git(['checkout', 'HEAD', '--', ...FILES]);
    git(['pull', '--rebase', '--autostash', 'origin', 'master']);

    writeJson(QUEUE_PATH, mergeQueues(localQueue, readJson(QUEUE_PATH, [])));
    writeJson(REGISTRY_PATH, mergeRegistries(localRegistry, readJson(REGISTRY_PATH, [])));

    git(['add', '--', ...FILES]);
    try {
      git(['diff', '--cached', '--quiet', '--', ...FILES], { quiet: true });
      log('ℹ️ Queue already matches GitHub — nothing to push.');
      return false;
    } catch {
      // staged differences exist
    }
    git(['commit', '-m', message, '--', ...FILES]);
    try {
      git(['push', 'origin', 'master']);
      log('✅ Queue merged and pushed to GitHub.');
      return true;
    } catch (e) {
      log(`⚠️ Push attempt ${attempt} failed (${e.message.split('\n')[0]}). Retrying...`);
      git(['reset', '--soft', 'HEAD~1']);
    }
  }
  throw new Error('Could not push the queue after 3 attempts — run `node scripts/publish-reel.js --sync` again later');
}

module.exports = { mergeQueues, mergeRegistries, syncAndPush, FILES };
