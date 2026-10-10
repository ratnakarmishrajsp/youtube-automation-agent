// Shared Instagram Graph API helpers used by the reel scheduler, the auto-DM
// monitor and publish-reel. Keep this file free of secrets: it is committed to
// the public repo because the GitHub Actions publisher needs it.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GRAPH_URL = 'https://graph.instagram.com/v20.0';
const ROOT = path.join(__dirname, '..', '..');
const QUEUE_PATH = path.join(ROOT, 'data', 'instagram_reels_queue.json');
const REGISTRY_PATH = path.join(ROOT, 'data', 'auto_dm_registry.json');

class GraphError extends Error {
  constructor(message, error) {
    super(message);
    this.code = error && error.code;
    this.subcode = error && error.error_subcode;
    this.graphError = error;
  }
}

function credentials() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error('INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_ACCOUNT_ID missing (check .env or GitHub secrets)');
  }
  return { token, accountId };
}

async function graph(method, endpoint, params = {}) {
  const { token } = credentials();
  const url = new URL(endpoint.startsWith('http') ? endpoint : `${GRAPH_URL}/${endpoint.replace(/^\//, '')}`);
  const init = { method };
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
  } else {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify({ ...params, access_token: token });
  }
  const res = await fetch(url, init);
  const data = await res.json();
  if (data && data.error) {
    throw new GraphError(`${method} ${url.pathname}: ${data.error.message}`, data.error);
  }
  return data;
}

// ---------- JSON files ----------

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Write to a temp file then rename, so a crash never leaves half-written JSON.
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// ---------- schedule time ----------

// Accepts every format already present in the queue:
//   "2026-10-10 20:00:00 IST", "10-10-2026 20:00:00 IST", "4/10/2026, 5:20:25 pm IST"
// plus an explicit "scheduledAtUTC" ISO string. Returns epoch ms or NaN.
function parseScheduleTime(reel) {
  if (reel.scheduledAtUTC) return Date.parse(reel.scheduledAtUTC);
  if (!reel.scheduledTimeIST) return NaN;
  const s = reel.scheduledTimeIST.replace(/IST/i, '').replace(',', ' ').trim();
  const m = s.match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return NaN;
  let [, a, month, b, hour, min, sec = '00', ampm] = m;
  const [year, day] = a.length === 4 ? [a, b] : [b, a];
  hour = Number(hour);
  if (ampm) {
    if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
  }
  const pad = (v) => String(v).padStart(2, '0');
  return Date.parse(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${min}:${pad(sec)}+05:30`);
}

function formatIST(ms) {
  return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// ---------- feed / dedup ----------

function captionKey(caption) {
  return String(caption || '').split('\n')[0].trim().toLowerCase().replace(/\s+/g, ' ');
}

async function recentMedia(limit = 25) {
  const { accountId } = credentials();
  const data = await graph('GET', `${accountId}/media`, {
    fields: 'id,caption,permalink,timestamp,comments_count',
    limit: String(limit),
  });
  return data.data || [];
}

// Finds a post on the profile whose caption first line matches this reel's.
async function findLiveMatch(reel, media) {
  const key = captionKey(reel.caption);
  if (key.length <= 15) return null;
  const items = media || await recentMedia();
  return items.find((item) => captionKey(item.caption) === key) || null;
}

// ---------- CDN ----------

function uploadToCdn(filePath, log = console.log) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found for CDN upload: ${filePath}`);
  log(`📤 Uploading ${path.basename(filePath)} to CDN...`);
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const file = filePath.replace(/\\/g, '/');
  const hosts = [
    ['Catbox', ['-F', 'reqtype=fileupload', '-F', `fileToUpload=@${file}`, 'https://catbox.moe/user/api.php']],
    ['Litterbox (72h)', ['-F', 'reqtype=fileupload', '-F', 'time=72h', '-F', `fileToUpload=@${file}`, 'https://litterbox.catbox.moe/resources/internals/api.php']],
  ];
  for (const [name, args] of hosts) {
    try {
      const url = execFileSync(curl, ['-s', '--max-time', '300', ...args], { encoding: 'utf8' }).trim();
      if (url.startsWith('https://')) {
        log(`✅ Uploaded to ${name}: ${url}`);
        return url;
      }
      log(`⚠️ ${name} returned: ${url.slice(0, 120)}`);
    } catch (e) {
      log(`⚠️ ${name} upload failed: ${e.message}`);
    }
  }
  throw new Error(`CDN upload failed for ${filePath}`);
}

// ---------- containers / publishing ----------

async function createReelContainer({ videoUrl, coverUrl, caption }) {
  const { accountId } = credentials();
  const body = { media_type: 'REELS', video_url: videoUrl, caption };
  if (coverUrl) body.cover_url = coverUrl;
  const data = await graph('POST', `${accountId}/media`, body);
  return data.id;
}

async function containerStatus(containerId) {
  const data = await graph('GET', containerId, { fields: 'status_code,status' });
  return data.status_code || data.status || 'UNKNOWN';
}

// Polls until FINISHED. Network hiccups are retried; ERROR/EXPIRED stop at once.
async function waitForContainer(containerId, { attempts = 40, intervalMs = 6000, log = console.log } = {}) {
  for (let i = 1; i <= attempts; i++) {
    await sleep(intervalMs);
    let status;
    try {
      status = await containerStatus(containerId);
    } catch (e) {
      log(`⚠️ Poll ${i}/${attempts} failed: ${e.message}`);
      continue;
    }
    log(`📊 Poll ${i}/${attempts}: ${status}`);
    if (status === 'FINISHED' || status === 'PUBLISHED') return status;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Container ${containerId} ended with status ${status}`);
    }
  }
  throw new Error(`Container ${containerId} still processing after ${attempts} polls`);
}

async function publishContainer(containerId) {
  const { accountId } = credentials();
  const data = await graph('POST', `${accountId}/media_publish`, { creation_id: containerId });
  return data.id;
}

async function permalinkFor(mediaId) {
  try {
    const data = await graph('GET', mediaId, { fields: 'permalink' });
    return data.permalink || null;
  } catch {
    return null;
  }
}

// ---------- comments / DMs ----------

async function listComments(mediaId, { max = 300 } = {}) {
  const out = [];
  let page = await graph('GET', `${mediaId}/comments`, { fields: 'id,text,timestamp,username,from', limit: '50' });
  while (page) {
    out.push(...(page.data || []));
    if (out.length >= max || !page.paging || !page.paging.next) break;
    page = await graph('GET', page.paging.next);
  }
  return out;
}

// Instagram "private reply": one DM to the author of a comment (allowed within 7 days).
async function sendPrivateReply(commentId, text) {
  return graph('POST', 'me/messages', { recipient: { comment_id: commentId }, message: { text } });
}

async function replyToComment(commentId, message) {
  return graph('POST', `${commentId}/replies`, { message });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  GRAPH_URL,
  ROOT,
  QUEUE_PATH,
  REGISTRY_PATH,
  GraphError,
  credentials,
  graph,
  readJson,
  writeJson,
  parseScheduleTime,
  formatIST,
  captionKey,
  recentMedia,
  findLiveMatch,
  uploadToCdn,
  createReelContainer,
  containerStatus,
  waitForContainer,
  publishContainer,
  permalinkFor,
  listComments,
  sendPrivateReply,
  replyToComment,
  sleep,
};
