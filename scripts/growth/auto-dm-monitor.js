// Comment-to-DM automation. For every reel in data/auto_dm_registry.json, finds
// comments containing the reel's keyword (e.g. "CLAUDE") and sends the commenter a
// real Instagram DM ("private reply") with the link, then replies publicly.
// The public reply only claims "DM bhej diya" when the DM really went out.
//
//   node scripts/growth/auto-dm-monitor.js            run once (Windows task, every 5 min)
//   node scripts/growth/auto-dm-monitor.js --dry-run  show matches, send nothing
//
// NOTE: while the Meta app is in Development mode the API hides comments from
// everyone except app admins/testers. This script detects that and logs a warning.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ig = require('../lib/instagram');

const HISTORY_PATH = path.join(ig.ROOT, 'data', 'auto_dm_history.json');
const LOG_FILE = path.join(ig.ROOT, 'logs', 'auto_dm_monitor.log');
const OWN_USERNAME = 'ratnakarcontent';
const DM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // Instagram allows private replies for 7 days
const SCAN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // stop scanning reels older than this
const FALLBACK_REPLY = 'Full video YouTube pe hai 👉 search karo "Ratnakar Mishra Digital Marketing" 📺';

function log(msg) {
  console.log(msg);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // logging must never stop the monitor
  }
}

// "claude" matches "CLAUDE", "Claude please", "claudeai" — but not "unclaude".
function matchesKeyword(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.some((k) => {
    const escaped = String(k).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}`).test(lower);
  });
}

// Fill mediaId for entries whose reel was published by another machine (e.g. GitHub Actions).
async function resolveMediaIds(registry, feed) {
  const queue = ig.readJson(ig.QUEUE_PATH, []);
  let changed = false;
  for (const entry of registry) {
    if (entry.mediaId || !entry.queueId) continue;
    const reel = queue.find((r) => r.id === entry.queueId);
    if (!reel) continue;
    const live = reel.publishedMediaId ? { id: reel.publishedMediaId, permalink: reel.permalink, timestamp: reel.publishedAt } : await ig.findLiveMatch(reel, feed);
    if (!live) continue;
    entry.mediaId = live.id;
    entry.permalink = live.permalink;
    entry.publishedAt = live.timestamp;
    changed = true;
    log(`🔗 Linked Reel #${entry.queueId} to media ${live.id}`);
  }
  return changed;
}

async function checkAndReplyComments({ dryRun = false } = {}) {
  const registry = ig.readJson(ig.REGISTRY_PATH, []);
  const history = ig.readJson(HISTORY_PATH, {});
  const feed = await ig.recentMedia(50);
  const feedById = new Map(feed.map((m) => [m.id, m]));

  let registryChanged = await resolveMediaIds(registry, feed);
  let hiddenComments = 0;
  let errors = 0;
  const now = Date.now();

  for (const entry of registry) {
    if (!entry.mediaId) continue;
    const media = feedById.get(entry.mediaId);
    if (media && !entry.publishedAt) {
      entry.publishedAt = media.timestamp;
      registryChanged = true;
    }
    const publishedMs = Date.parse(entry.publishedAt || '') || 0;
    if (publishedMs && now - publishedMs > SCAN_WINDOW_MS) continue;
    if (media && !media.comments_count) continue;

    let comments;
    try {
      comments = await ig.listComments(entry.mediaId);
    } catch (e) {
      errors++;
      log(`❌ Could not read comments for "${entry.title}": ${e.message}`);
      continue;
    }
    if (media && media.comments_count > 0 && comments.length === 0) hiddenComments += media.comments_count;

    for (const comment of comments) {
      const username = comment.username || (comment.from && comment.from.username) || 'unknown';
      if (username === OWN_USERNAME) continue;
      if (history[comment.id]) continue;
      if (now - Date.parse(comment.timestamp) > DM_WINDOW_MS) continue;
      if (!matchesKeyword(comment.text, entry.keywords || ['link'])) continue;

      const userKey = `dm:${entry.mediaId}:${username}`;
      log(`🎯 "${entry.title}" — @${username}: "${comment.text}"`);
      if (dryRun) {
        log(history[userKey] ? '   [dry-run] already DMed this user for this reel, would skip' : '   [dry-run] would send DM + public reply');
        continue;
      }

      const record = { mediaId: entry.mediaId, user: username, commentText: comment.text, processedAt: new Date().toISOString(), youtubeUrl: entry.youtubeUrl };
      if (history[userKey]) {
        history[comment.id] = { ...record, skipped: 'already DMed for this reel' };
        ig.writeJson(HISTORY_PATH, history);
        continue;
      }

      let dmSent = false;
      try {
        await ig.sendPrivateReply(comment.id, entry.dmMessage || `Ye raha link 👉 ${entry.youtubeUrl}`);
        dmSent = true;
        log(`   📩 DM sent to @${username}`);
      } catch (e) {
        record.dmError = e.message;
        log(`   ⚠️ DM failed for @${username}: ${e.message}`);
      }

      try {
        const reply = dmSent ? (entry.replyComment || 'Link aapke DM mein bhej diya hai! 📩') : FALLBACK_REPLY;
        await ig.replyToComment(comment.id, `@${username} ${reply}`);
        log(`   💬 Public reply posted (${dmSent ? 'DM confirmation' : 'fallback, no DM'})`);
      } catch (e) {
        record.replyError = e.message;
        log(`   ⚠️ Public reply failed: ${e.message}`);
      }

      history[comment.id] = { ...record, dmSent };
      if (dmSent) history[userKey] = { at: record.processedAt, commentId: comment.id };
      ig.writeJson(HISTORY_PATH, history);
    }
  }

  if (registryChanged) ig.writeJson(ig.REGISTRY_PATH, registry);
  if (hiddenComments > 0) {
    log(`⚠️ ${hiddenComments} comment(s) exist but the API returned none. The Meta app is most likely in Development mode — switch it to Live (App Dashboard → App Review) or no real follower will ever get a DM.`);
  }
  return { errors, hiddenComments };
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  checkAndReplyComments({ dryRun })
    .then(({ errors }) => {
      log(`✅ Auto-DM scan complete${dryRun ? ' (dry-run)' : ''}.`);
      if (errors) process.exitCode = 1;
    })
    .catch((err) => {
      log(`💥 Auto-DM monitor failed: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { checkAndReplyComments, matchesKeyword };
