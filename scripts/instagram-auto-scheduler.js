try {
  require('dotenv').config();
} catch (e) {}
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com/v20.0';
const token = process.env.INSTAGRAM_ACCESS_TOKEN;
const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

const QUEUE_PATH = path.join(__dirname, '..', 'data', 'instagram_reels_queue.json');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'instagram_scheduler.log');
const LOCK_FILE = path.join(__dirname, '..', 'data', 'instagram_scheduler.lock');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {}
}

// ==========================================
// SAFEGUARD 1: PROCESS MUTEX / LOCKFILE
// Prevents two scheduled tasks or manual triggers from running at once
// ==========================================
function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const content = fs.readFileSync(LOCK_FILE, 'utf8');
      const lockData = JSON.parse(content);
      const ageMs = Date.now() - lockData.timestamp;
      // If lock is younger than 20 minutes, another publisher is active
      if (ageMs < 20 * 60 * 1000) {
        log(`⛔ Another publisher process (PID ${lockData.pid}) is currently active (${Math.round(ageMs / 1000)}s old). Exiting to prevent duplicate uploads.`);
        return false;
      } else {
        log(`⚠️ Overriding stale lockfile from PID ${lockData.pid} (${Math.round(ageMs / 60000)}m old).`);
      }
    }
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), 'utf8');
    return true;
  } catch (e) {
    log(`⚠️ Lock check error: ${e.message}`);
    return true;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (e) {}
}

process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(); });
process.on('SIGTERM', () => { releaseLock(); process.exit(); });

function uploadToCatbox(filePath) {
  log(`📤 Uploading ${path.basename(filePath)} to CDN...`);
  const normalized = filePath.replace(/\\/g, '/');
  const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';

  // Try Catbox first (reliable & fast up to 200MB)
  try {
    const cmd2 = `${curlBin} -s --max-time 180 -F "reqtype=fileupload" -F "fileToUpload=@${normalized}" https://catbox.moe/user/api.php`;
    const url2 = execSync(cmd2, { encoding: 'utf8' }).trim();
    if (url2.startsWith('https://')) {
      log(`✅ Uploaded to CDN (Catbox): ${url2}`);
      return url2;
    }
  } catch (e) {
    log(`⚠️ Catbox upload notice: ${e.message}. Trying Litterbox...`);
  }

  // Fallback to Litterbox
  try {
    const cmd = `${curlBin} -s --max-time 180 -F "reqtype=fileupload" -F "time=72h" -F "fileToUpload=@${normalized}" https://litterbox.catbox.moe/resources/internals/api.php`;
    const url = execSync(cmd, { encoding: 'utf8' }).trim();
    if (url.startsWith('https://')) {
      log(`✅ Uploaded to CDN (Litterbox): ${url}`);
      return url;
    }
  } catch (e) {
    log(`⚠️ Litterbox upload notice: ${e.message}`);
  }

  throw new Error(`CDN upload failed for ${filePath}`);
}

// Convert "YYYY-MM-DD HH:mm:ss IST" or "DD-MM-YYYY HH:mm:ss" to epoch ms
function parseScheduleTime(reel) {
  if (reel.scheduledTimeIST) {
    const cleaned = reel.scheduledTimeIST.replace(' IST', '').trim();
    const [datePart, timePart] = cleaned.split(' ');
    let year, month, day;
    if (datePart.includes('-')) {
      const parts = datePart.split('-');
      if (parts[0].length === 4) {
        [year, month, day] = parts;
      } else {
        [day, month, year] = parts;
      }
    }
    const [hour, min, sec] = timePart.split(':');
    const isoStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hour}:${min}:${sec || '00'}+05:30`;
    return new Date(isoStr).getTime();
  }
  return 0;
}

// ==========================================
// SAFEGUARD 2: PRE-PUBLISH FEED DEDUPLICATION
// Checks if this reel was already posted on Instagram in the last 24h
// ==========================================
async function checkIfAlreadyLive(reel) {
  try {
    log(`🔍 Checking Instagram live feed to ensure Reel #${reel.id} isn't already posted...`);
    const res = await fetch(`${INSTAGRAM_GRAPH_URL}/${accountId}/media?fields=id,caption,permalink,timestamp&limit=15&access_token=${token}`);
    const data = await res.json();
    if (data && Array.isArray(data.data)) {
      const firstLine = reel.caption.split('\n')[0].trim().toLowerCase();
      for (const item of data.data) {
        if (!item.caption) continue;
        const itemFirstLine = item.caption.split('\n')[0].trim().toLowerCase();
        if (itemFirstLine.length > 15 && itemFirstLine === firstLine) {
          return item; // Found identical post on profile!
        }
      }
    }
  } catch (err) {
    log(`⚠️ Live feed deduplication check warning: ${err.message}`);
  }
  return null;
}

async function createFreshContainer(reel) {
  let freshVideoUrl = reel.videoUrl;
  let freshCoverUrl = reel.coverUrl;

  const baseDir = path.join(__dirname, '..');
  const videoFullPath = reel.localVideoPath ? (path.isAbsolute(reel.localVideoPath) ? reel.localVideoPath : path.join(baseDir, reel.localVideoPath)) : null;
  const coverFullPath = reel.localCoverPath ? (path.isAbsolute(reel.localCoverPath) ? reel.localCoverPath : path.join(baseDir, reel.localCoverPath)) : null;

  if (!freshVideoUrl) {
    if (!videoFullPath || !fs.existsSync(videoFullPath)) throw new Error(`Video file not found: ${videoFullPath}`);
    log(`🔄 Uploading fresh video for Reel #${reel.id}...`);
    freshVideoUrl = uploadToCatbox(videoFullPath);
  }
  if (!freshCoverUrl) {
    if (!coverFullPath || !fs.existsSync(coverFullPath)) throw new Error(`Cover file not found: ${coverFullPath}`);
    log(`🔄 Uploading fresh cover for Reel #${reel.id}...`);
    freshCoverUrl = uploadToCatbox(coverFullPath);
  }

  log(`📦 Creating fresh Meta Reel Container for Reel #${reel.id}...`);
  const createRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${accountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: freshVideoUrl,
      cover_url: freshCoverUrl,
      caption: reel.caption,
      access_token: token
    })
  });

  const createData = await createRes.json();
  if (createData.error) {
    throw new Error('Container creation failed: ' + JSON.stringify(createData.error));
  }

  const containerId = createData.id;
  log(`✅ Container Created! ID: ${containerId}`);

  log(`⏳ Waiting for Meta servers to transcode video & apply cover...`);
  let isReady = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const sRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${containerId}?fields=status_code,status&access_token=${token}`);
    const sData = await sRes.json();
    log(`📊 Poll [${i + 1}/30]: Status = ${sData.status_code || sData.status}`);
    if (sData.status_code === 'FINISHED' || sData.status === 'FINISHED') {
      isReady = true;
      break;
    }
    if (sData.status_code === 'ERROR') {
      throw new Error('Transcode error: ' + JSON.stringify(sData));
    }
  }

  if (!isReady) {
    throw new Error('Container processing timed out on Meta.');
  }

  reel.containerId = containerId;
  reel.videoUrl = freshVideoUrl;
  reel.coverUrl = freshCoverUrl;
  return containerId;
}

async function publishSingleReel(reel, queue) {
  log(`\n====================================================`);
  log(`🚀 PUBLISHING SCHEDULED REEL #${reel.id}: "${reel.title}"`);
  log(`⏰ Target Time: ${reel.scheduledTimeIST}`);
  log(`====================================================`);

  // ==========================================
  // SAFEGUARD 3: IMMEDIATE PERSISTENT STATUS LOCK
  // Mark as 'PROCESSING' on disk instantly so no other run touches it
  // ==========================================
  reel.status = 'PROCESSING';
  reel.processingStartedAt = new Date().toISOString();
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));

  // Check if already live on Instagram
  const alreadyLive = await checkIfAlreadyLive(reel);
  if (alreadyLive) {
    log(`🛑 DEDUPLICATION SAFETY TRIGGERED: Reel #${reel.id} is already live on Instagram!`);
    log(`🔗 Existing Live Link: ${alreadyLive.permalink} (Media ID: ${alreadyLive.id})`);
    reel.status = 'PUBLISHED';
    reel.publishedMediaId = alreadyLive.id;
    reel.permalink = alreadyLive.permalink;
    reel.publishedAt = alreadyLive.timestamp || new Date().toISOString();
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
    return;
  }

  let containerId = reel.containerId;
  let publishSuccessful = false;

  // Step 1: If containerId exists, check status
  if (containerId) {
    try {
      const statusRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${containerId}?fields=status_code,status&access_token=${token}`);
      const statusData = await statusRes.json();
      log(`📊 Existing Container Status: ${JSON.stringify(statusData)}`);

      if (statusData.status_code === 'FINISHED' || statusData.status === 'FINISHED') {
        log(`🚀 Attempting media_publish with existing container ${containerId}...`);
        const pubRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${accountId}/media_publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: containerId,
            access_token: token
          })
        });
        const pubData = await pubRes.json();
        if (!pubData.error) {
          reel.publishedMediaId = pubData.id;
          publishSuccessful = true;
          log(`🎉 Published Successfully with existing container! Media ID: ${pubData.id}`);
        } else {
          log(`⚠️ Existing container failed with error: ${pubData.error.message} (Subcode: ${pubData.error.error_subcode}). Self-healing...`);
        }
      }
    } catch (e) {
      log(`⚠️ Existing container check failed: ${e.message}. Triggering fresh container...`);
    }
  }

  // Step 2: Self-Healing if not published yet
  if (!publishSuccessful) {
    containerId = await createFreshContainer(reel);
    log(`🚀 Triggering media_publish with fresh container ${containerId}...`);
    const pubRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${accountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: token
      })
    });
    const pubData = await pubRes.json();
    if (pubData.error) {
      // Reset status so it can retry later if it was an API failure
      reel.status = 'READY_TO_PUBLISH';
      fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
      throw new Error(`Publish failed: ${JSON.stringify(pubData.error)}`);
    }
    reel.publishedMediaId = pubData.id;
    log(`🎉 Published Successfully! Media ID: ${pubData.id}`);
  }

  // Step 3: Fetch Live Permalink
  let permalink = 'https://www.instagram.com/ratnakarcontent/reels/';
  try {
    const pRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${reel.publishedMediaId}?fields=permalink&access_token=${token}`);
    const pData = await pRes.json();
    if (pData.permalink) {
      permalink = pData.permalink;
    }
  } catch (e) {}

  reel.status = 'PUBLISHED';
  reel.permalink = permalink;
  reel.publishedAt = new Date().toISOString();

  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));

  log(`\n====================================================`);
  log(`✅ REEL #${reel.id} IS LIVE ON INSTAGRAM!`);
  log(`🔗 LINK: ${permalink}`);
  log(`====================================================\n`);
}

async function processQueue(forceId = null) {
  if (!fs.existsSync(QUEUE_PATH)) {
    log(`⚠️ Queue file not found: ${QUEUE_PATH}`);
    return;
  }

  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
  } catch (e) {
    log(`❌ Failed to read queue JSON: ${e.message}`);
    return;
  }

  const nowMs = Date.now();

  for (const reel of queue) {
    if (forceId !== null) {
      if (reel.id === forceId) {
        if (reel.status === 'PUBLISHED') {
          log(`ℹ️ Reel #${reel.id} is already marked as PUBLISHED: ${reel.permalink}`);
          return;
        }
        await publishSingleReel(reel, queue);
        return;
      }
      continue;
    }

    if (reel.status === 'READY_TO_PUBLISH' || reel.status === 'QUEUED') {
      const scheduledMs = parseScheduleTime(reel);
      if (scheduledMs > 0 && nowMs >= scheduledMs) {
        log(`⏰ Scheduled time reached for Reel #${reel.id} ("${reel.title}"): Scheduled ${reel.scheduledTimeIST}, Current: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
        try {
          await publishSingleReel(reel, queue);
        } catch (err) {
          log(`❌ Error processing Reel #${reel.id}: ${err.message}`);
        }
      }
    }
  }
}

async function main() {
  // Acquire global process lock
  if (!acquireLock()) {
    process.exit(0);
  }

  try {
    const args = process.argv.slice(2);
    const isDaemon = args.includes('--daemon');
    const forceIdx = args.indexOf('--force');
    const forceId = forceIdx !== -1 && args[forceIdx + 1] ? parseInt(args[forceIdx + 1], 10) : null;

    if (forceId) {
      log(`⚡ Force publishing Reel #${forceId}...`);
      await processQueue(forceId);
      return;
    }

    if (isDaemon) {
      log(`🔄 Instagram Auto-Scheduler Daemon ACTIVE. Checking queue every 60 seconds...`);
      while (true) {
        try {
          await processQueue();
        } catch (e) {
          log(`❌ Daemon loop error: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 60000));
      }
    } else {
      log(`🔍 Checking Instagram Reels Queue...`);
      await processQueue();
      log(`🏁 Queue check complete.`);
    }
  } finally {
    releaseLock();
  }
}

main().catch(err => {
  releaseLock();
  log(`💥 Fatal error: ${err.message}`);
  process.exit(1);
});
