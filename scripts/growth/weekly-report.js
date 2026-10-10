// Weekly content report from real YouTube numbers: which topics, formats and
// hooks are working, and which topics were repeated. Read-only.
//
//   node scripts/growth/weekly-report.js        writes reports/growth/weekly-<date>.md
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { recentUploads } = require('../lib/youtube');

const ROOT = path.join(__dirname, '..', '..');
const DAY = 864e5;

const TOPICS = [
  ['E-commerce / RTO', /rto|shiprocket|delhivery|delivery|courier|cod\b|order|shopify|dropship|roposo/i],
  ['Meta Ads', /meta ads|ads limit|campaign|cjp|roas|ad creative|ads ka|ads ruk/i],
  ['AI tools', /claude|\bai\b|antigravity|gemini|hyperframes|remotion|cursor|agent|heygen/i],
];

function topicOf(title) {
  const hit = TOPICS.find(([, re]) => re.test(title));
  return hit ? hit[0] : 'Other';
}

function seconds(iso) {
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function words(title) {
  return new Set(title.toLowerCase().replace(/#\w+/g, '').match(/[a-z0-9₹]{4,}/g) || []);
}

function similarity(a, b) {
  const wa = words(a);
  const wb = words(b);
  const common = [...wa].filter((w) => wb.has(w)).length;
  return common / Math.max(1, Math.min(wa.size, wb.size));
}

async function main() {
  const now = Date.now();
  const videos = (await recentUploads(50))
    .filter((v) => v.status.privacyStatus === 'public')
    .map((v) => {
      const published = Date.parse(v.snippet.publishedAt);
      const views = Number(v.statistics.viewCount || 0);
      const likes = Number(v.statistics.likeCount || 0);
      const length = seconds(v.contentDetails.duration);
      return {
        id: v.id,
        title: v.snippet.title,
        published,
        ageDays: Math.max(1, (now - published) / DAY),
        views,
        likes,
        comments: Number(v.statistics.commentCount || 0),
        likeRate: views ? likes / views : 0,
        // Shorts may run up to 3 min, so trust #Shorts in the title; otherwise only <=60s counts.
        format: length <= 60 || (length <= 180 && /#shorts/i.test(v.snippet.title)) ? 'Short' : 'Long',
        topic: topicOf(v.snippet.title),
      };
    });
  if (!videos.length) throw new Error('No public videos found');

  const lines = [];
  const date = new Date().toISOString().slice(0, 10);
  lines.push(`# Weekly content report — ${date}`, '', `Based on the last ${videos.length} public uploads. Views are lifetime totals, so newer videos are still growing.`, '');

  lines.push('## Top 5 by views', '', '| Views | Likes | Format | Topic | Title |', '|---:|---:|---|---|---|');
  [...videos].sort((a, b) => b.views - a.views).slice(0, 5).forEach((v) => {
    lines.push(`| ${v.views} | ${v.likes} | ${v.format} | ${v.topic} | [${v.title.replace(/\|/g, '/')}](https://youtu.be/${v.id}) |`);
  });

  lines.push('', '## Shorts by topic (median views)', '', '| Topic | Shorts | Median views | Best |', '|---|---:|---:|---|');
  const shorts = videos.filter((v) => v.format === 'Short');
  const byTopic = {};
  shorts.forEach((v) => (byTopic[v.topic] = byTopic[v.topic] || []).push(v));
  Object.entries(byTopic)
    .map(([topic, list]) => ({ topic, list, med: median(list.map((v) => v.views)) }))
    .sort((a, b) => b.med - a.med)
    .forEach(({ topic, list, med }) => {
      const best = list.reduce((a, b) => (b.views > a.views ? b : a));
      lines.push(`| ${topic} | ${list.length} | ${med} | ${best.views} — ${best.title.slice(0, 50).replace(/\|/g, '/')} |`);
    });

  const longs = videos.filter((v) => v.format === 'Long');
  lines.push('', '## Format', '', `- Shorts: ${shorts.length} videos, median ${median(shorts.map((v) => v.views))} views`, `- Long videos: ${longs.length} videos, median ${median(longs.map((v) => v.views))} views`);

  const last7 = videos.filter((v) => now - v.published < 7 * DAY);
  lines.push('', '## This week', '', `- Uploads: ${last7.length}`, `- Views on this week's uploads so far: ${last7.reduce((s, v) => s + v.views, 0)}`);

  const repeats = [];
  for (let i = 0; i < videos.length; i++) {
    for (let j = i + 1; j < videos.length; j++) {
      if (videos[i].format === videos[j].format && similarity(videos[i].title, videos[j].title) >= 0.6) repeats.push([videos[i], videos[j]]);
    }
  }
  lines.push('', '## Repeated topics', '');
  if (!repeats.length) lines.push('None found.');
  repeats.slice(0, 8).forEach(([a, b]) => lines.push(`- ${a.views} views "${a.title.slice(0, 55)}" ↔ ${b.views} views "${b.title.slice(0, 55)}"`));
  if (repeats.length) {
    lines.push('', 'Same topic re-posted with a new hook can win (compare the views), but repeated near-identical uploads risk YouTube\'s "reused content" review. Prefer testing 2–3 hooks before the first upload.');
  }

  const lowLikes = shorts.filter((v) => v.views >= 100 && v.likeRate < 0.01);
  if (lowLikes.length) {
    lines.push('', '## Low like rate (under 1% on 100+ views)', '');
    lowLikes.forEach((v) => lines.push(`- ${v.views} views, ${v.likes} likes — ${v.title.slice(0, 70)}`));
  }

  const out = path.join(ROOT, 'reports', 'growth', `weekly-${date}.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  console.log(`\n📄 Saved: ${path.relative(ROOT, out)}`);
}

main().catch((err) => {
  console.error(`💥 ${err.message}`);
  process.exit(1);
});
