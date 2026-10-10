// One screen for the whole pipeline: what is scheduled, what failed, what went live,
// whether auto-DM is working, and when the publishers last ran.
//
//   node scripts/status.js          local records only (instant)
//   node scripts/status.js --live   also fetch live views from YouTube + Instagram
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ig = require('./lib/instagram');

const LIVE = process.argv.includes('--live');
const now = Date.now();
const short = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || '')).padEnd(n);

function lastLogLine(file, pattern) {
  const full = path.join(ig.ROOT, 'logs', file);
  if (!fs.existsSync(full)) return null;
  const lines = fs.readFileSync(full, 'utf8').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!pattern || pattern.test(lines[i])) return lines[i];
  }
  return null;
}

function ago(ms) {
  const min = Math.round((now - ms) / 60000);
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

function section(title) {
  console.log(`\n━━━ ${title} ${'━'.repeat(Math.max(0, 60 - title.length))}`);
}

async function main() {
  const queue = ig.readJson(ig.QUEUE_PATH, []);
  const registry = ig.readJson(ig.REGISTRY_PATH, []);
  const ytHistory = [
    ...ig.readJson(path.join(ig.ROOT, 'data', 'youtube_scheduled_shorts.json'), []),
    ...ig.readJson(path.join(ig.ROOT, 'data', 'youtube_uploads_history.json'), []),
  ];
  const dmKeys = new Set(registry.map((e) => e.queueId).filter(Boolean));

  section('UPCOMING');
  const upcoming = queue
    .filter((r) => !['PUBLISHED', 'FAILED', 'NEEDS_REVIEW'].includes(r.status))
    .map((r) => ({ r, at: ig.parseScheduleTime(r) }))
    .sort((a, b) => a.at - b.at);
  const ytUpcoming = ytHistory
    .map((h) => ({ h, at: Date.parse(h.scheduledTimeUTC || h.publishAt || '') }))
    .filter(({ at }) => at > now)
    .sort((a, b) => a.at - b.at);
  if (!upcoming.length && !ytUpcoming.length) console.log('Nothing scheduled. Make a manifest from data/reels/_TEMPLATE.json');
  for (const { r, at } of upcoming) {
    const dm = r.caption && /comment\s+["“'‘]?\w+/i.test(r.caption) ? (dmKeys.has(r.id) ? 'DM ✅' : 'DM ❌ not registered') : '';
    console.log(`IG #${String(r.id).padEnd(3)} ${short(ig.formatIST(at), 24)} ${short(r.status, 17)} ${short(r.title, 45)} ${dm}`);
  }
  for (const { h, at } of ytUpcoming) {
    console.log(`YT     ${short(ig.formatIST(at), 24)} ${short('SCHEDULED', 17)} ${short(h.title, 45)} ${h.url || h.watchUrl || ''}`);
  }

  const problems = queue
    .filter((r) => ['FAILED', 'NEEDS_REVIEW'].includes(r.status) || r.lastError)
    .map((r) => `IG #${r.id} ${r.status}: ${r.title}\n      ${r.lastError || ''}`);
  for (const r of queue) {
    if (r.status !== 'PUBLISHED' || !r.publishedAt || now - Date.parse(r.publishedAt) > 7 * 864e5) continue;
    const lateMin = Math.round((Date.parse(r.publishedAt) - ig.parseScheduleTime(r)) / 60000);
    if (lateMin > 20) problems.push(`IG #${r.id} went live ${lateMin} min late: ${r.title}`);
  }
  section('PROBLEMS (last 7 days)');
  console.log(problems.length ? problems.join('\n') : 'None 👍');

  section('RECENTLY PUBLISHED (Instagram)');
  queue
    .filter((r) => r.status === 'PUBLISHED')
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
    .slice(0, 6)
    .forEach((r) => console.log(`#${String(r.id).padEnd(3)} ${short(ig.formatIST(Date.parse(r.publishedAt)), 24)} ${short(r.title, 45)} ${r.permalink}`));

  section('AUTO-DM');
  const history = ig.readJson(path.join(ig.ROOT, 'data', 'auto_dm_history.json'), {});
  const sent = Object.values(history).filter((h) => h && h.dmSent);
  console.log(`Registered reels: ${registry.length} | waiting for media ID: ${registry.filter((e) => !e.mediaId).length} | DMs sent by API: ${sent.length}`);
  const warn = lastLogLine('auto_dm_monitor.log', /Development mode/);
  const lastRun = lastLogLine('auto_dm_monitor.log', /scan complete/);
  const stamp = (line) => Date.parse(line.slice(1, 25));
  if (lastRun) console.log(`Last monitor run: ${ago(stamp(lastRun))}`);
  if (warn && lastRun && stamp(lastRun) - stamp(warn) < 60000) {
    console.log('⚠️  Meta app looks like it is in Development mode — real followers\' comments are hidden, so no DMs go out.');
  }

  section('PUBLISHERS');
  const sched = lastLogLine('instagram_scheduler.log');
  if (sched) console.log(`Laptop task last ran: ${ago(Date.parse(sched.slice(1, 25)))}`);
  try {
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ig.ROOT, encoding: 'utf8' }).trim();
    const repo = origin.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
    const out = execFileSync('gh', ['run', 'list', '--repo', repo, '--workflow', 'instagram-scheduler.yml', '--limit', '1', '--json', 'status,conclusion,createdAt'], { cwd: ig.ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [run] = JSON.parse(out);
    if (run) console.log(`Cloud publisher last run: ${ago(Date.parse(run.createdAt))} (${run.status}${run.conclusion ? `, ${run.conclusion}` : ''})`);
  } catch {
    console.log('Cloud publisher: (install/login GitHub CLI "gh" to see this)');
  }

  if (LIVE) {
    section('LIVE NUMBERS (last 10 YouTube uploads)');
    try {
      const { recentUploads } = require('./lib/youtube');
      const videos = await recentUploads(10);
      for (const v of videos) {
        console.log(`${String(v.statistics.viewCount || 0).padStart(6)} views  ${String(v.statistics.likeCount || 0).padStart(4)} likes  ${short(v.status.privacyStatus, 8)} ${short(v.snippet.title, 60)}`);
      }
    } catch (e) {
      console.log(`YouTube: ${e.message}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(`💥 ${err.message}`);
  process.exit(1);
});
