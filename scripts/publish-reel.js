// One command for every new reel/short, replacing the per-reel schedule_*.js scripts.
// Fill a manifest (copy data/reels/_TEMPLATE.json) and run:
//
//   node scripts/publish-reel.js data/reels/my-reel.json                    check rules + show plan (uploads nothing)
//   node scripts/publish-reel.js data/reels/my-reel.json --execute          YouTube schedule + Instagram queue + auto-DM
//   node scripts/publish-reel.js data/reels/my-reel.json --execute --push   ...and push the queue so GitHub Actions publishes it
//   node scripts/publish-reel.js --sync                                     merge laptop + cloud queue copies and push
//
// Progress is saved next to the manifest (<name>.state.json), so a re-run after a
// failure continues where it stopped and never uploads the same video twice.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ig = require('./lib/instagram');
const { buildDmMessage } = require('./lib/dm-registry');

const YT_HISTORY_PATH = path.join(ig.ROOT, 'data', 'youtube_scheduled_shorts.json');
const MIN_LEAD_MS = 15 * 60 * 1000;
const CONTAINER_LIFETIME_MS = 20 * 60 * 60 * 1000; // Meta containers expire after ~24h

const abs = (p) => (p ? (path.isAbsolute(p) ? p : path.join(ig.ROOT, p)) : null);
const rel = (p) => path.relative(ig.ROOT, p).replace(/\\/g, '/');
const hashtags = (text) => String(text || '').match(/#[\p{L}\p{N}_]+/gu) || [];
const sizeMb = (f) => (fs.statSync(f).size / (1024 * 1024)).toFixed(1);

// "DD-MM-YYYY HH:mm:ss IST", the format the queue has always used.
function queueTimeString(ms) {
  const d = new Date(ms + 5.5 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00 IST`;
}

function validate(m, state) {
  const errors = [];
  const warnings = [];
  const video = abs(m.video);
  const cover = abs(m.cover);
  const at = ig.parseScheduleTime({ scheduledTimeIST: String(m.publishAt || '') });

  if (!m.title) errors.push('"title" is missing');
  if (!video || !fs.existsSync(video)) errors.push(`video not found: ${m.video}`);
  if (m.cover && !fs.existsSync(cover)) errors.push(`cover not found: ${m.cover}`);
  if (!m.cover) warnings.push('no cover image — Instagram will pick a frame');
  if (Number.isNaN(at)) errors.push(`"publishAt" not understood: "${m.publishAt}" (use "2026-10-12 20:00", IST)`);
  else if (!state.youtube && !state.instagram && at < Date.now() + MIN_LEAD_MS) errors.push('"publishAt" must be at least 15 minutes in the future');
  if (!m.youtube && !m.instagram) errors.push('both "youtube" and "instagram" are off — nothing to do');

  const devanagari = /[ऀ-ॿ]/;
  if (m.youtube) {
    const y = m.youtube;
    if (!y.title) errors.push('youtube.title is missing');
    else if (y.title.length > 100) errors.push(`youtube.title is ${y.title.length} chars (max 100)`);
    if (!/#shorts/i.test(`${y.title} ${y.description}`)) warnings.push('add #Shorts to the YouTube title or description');
    const tags = y.tags || [];
    if (tags.length < 5 || tags.length > 7) errors.push(`youtube.tags has ${tags.length} tags — the rule is 5 to 7`);
    if (tags.join(',').length > 450) errors.push('youtube.tags are too long in total (max ~450 characters)');
    if ((y.description || '').length > 5000) errors.push('youtube.description is over 5000 characters');
    if (y.thumbnail && !fs.existsSync(abs(y.thumbnail))) errors.push(`youtube.thumbnail not found: ${y.thumbnail}`);
    if (devanagari.test(`${y.title} ${y.description}`)) warnings.push('YouTube text contains Devanagari — the house rule is Latin/Hinglish only');
    const history = ig.readJson(YT_HISTORY_PATH, []);
    if (!state.youtube && history.some((h) => h.title === y.title)) warnings.push('a YouTube upload with this exact title already exists in history');
  }

  if (m.instagram) {
    const caption = m.instagram.caption || '';
    const tags = hashtags(caption);
    if (!caption) errors.push('instagram.caption is missing');
    if (caption.length > 2200) errors.push(`instagram.caption is ${caption.length} chars (max 2200)`);
    if (!tags.some((t) => t.toLowerCase() === '#reels')) errors.push('instagram.caption must include #Reels');
    if (tags.length < 5 || tags.length > 7) errors.push(`instagram.caption has ${tags.length} hashtags — the rule is 5 to 7`);
    if (devanagari.test(caption)) warnings.push('Instagram caption contains Devanagari — the house rule is Latin/Hinglish only');

    const cta = caption.match(/comment\s+["“'‘]?([A-Za-z0-9]+)/i);
    if (cta && !m.dm) errors.push(`caption asks people to comment "${cta[1]}" but there is no "dm" block — nobody would get the DM`);
    if (cta && m.dm && m.dm.keyword && cta[1].toLowerCase() !== m.dm.keyword.toLowerCase()) {
      warnings.push(`caption says comment "${cta[1]}" but dm.keyword is "${m.dm.keyword}"`);
    }
    if (!state.instagram) {
      const queue = ig.readJson(ig.QUEUE_PATH, []);
      if (queue.some((r) => ig.captionKey(r.caption) === ig.captionKey(caption))) {
        errors.push('a reel with the same first caption line is already in the Instagram queue');
      }
    }
  }

  if (m.dm) {
    if (!m.dm.keyword) errors.push('dm.keyword is missing');
    if (!/^https:\/\//.test(m.dm.link || '')) errors.push('dm.link must be a full https:// link');
  }
  return { errors, warnings, at, video, cover };
}

function printPlan(m, state, { at, video, cover }) {
  console.log(`\n📋 ${m.title}`);
  if (video && fs.existsSync(video)) console.log(`   Video:     ${rel(video)} (${sizeMb(video)} MB)`);
  if (cover && fs.existsSync(cover)) console.log(`   Cover:     ${rel(cover)}`);
  if (!Number.isNaN(at)) console.log(`   Time:      ${ig.formatIST(at)} IST (YouTube + Instagram)`);
  if (m.youtube) {
    console.log(`   YouTube:   ${state.youtube ? `✅ done (${state.youtube.url})` : `"${m.youtube.title}" | ${(m.youtube.tags || []).length} tags`}`);
  }
  if (m.instagram) {
    console.log(`   Instagram: ${state.instagram ? `✅ queued as reel #${state.instagram.queueId}` : `${hashtags(m.instagram.caption).join(' ')}`}`);
  }
  if (m.dm) console.log(`   Auto-DM:   comment "${m.dm.keyword}" → ${m.dm.link}${state.dm ? ' ✅ registered' : ''}`);
}

async function scheduleYouTube(m, state, ctx, save) {
  const yt = require('./lib/youtube');
  const publishAt = new Date(ctx.at).toISOString();
  console.log(`\n🔴 YouTube: uploading ${path.basename(ctx.video)}...`);
  const videoId = await yt.uploadScheduled({
    file: ctx.video,
    title: m.youtube.title,
    description: m.youtube.description || '',
    tags: m.youtube.tags,
    categoryId: m.youtube.categoryId || '28',
    publishAt,
  });
  state.youtube = { videoId, publishAt, url: `https://youtube.com/shorts/${videoId}` };
  save();
  console.log(`✅ YouTube scheduled: ${state.youtube.url}`);

  if (m.youtube.thumbnail) {
    try {
      await yt.setThumbnail(videoId, abs(m.youtube.thumbnail));
      console.log('✅ Custom thumbnail set');
    } catch (e) {
      console.log(`⚠️ Thumbnail not set (${e.message}) — the video is still scheduled`);
    }
  }

  const history = ig.readJson(YT_HISTORY_PATH, []);
  history.push({
    videoId,
    title: m.youtube.title,
    scheduledTimeIST: queueTimeString(ctx.at),
    scheduledTimeUTC: publishAt,
    url: state.youtube.url,
    manifest: rel(ctx.manifestPath),
    createdAt: new Date().toISOString(),
  });
  ig.writeJson(YT_HISTORY_PATH, history);
}

async function queueInstagram(m, state, ctx, save) {
  console.log('\n📸 Instagram: uploading media to CDN...');
  const videoUrl = ig.uploadToCdn(ctx.video);
  const coverUrl = ctx.cover && fs.existsSync(ctx.cover) ? ig.uploadToCdn(ctx.cover) : null;

  let containerId = null;
  if (ctx.at - Date.now() < CONTAINER_LIFETIME_MS) {
    console.log('📦 Pre-processing the reel on Meta so it publishes instantly at the scheduled time...');
    containerId = await ig.createReelContainer({ videoUrl, coverUrl, caption: m.instagram.caption });
    await ig.waitForContainer(containerId);
  } else {
    console.log('ℹ️ Scheduled more than 20h ahead — the publisher will process it at publish time.');
  }

  const queue = ig.readJson(ig.QUEUE_PATH, []);
  const id = queue.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
  const timeString = queueTimeString(ctx.at);
  queue.push({
    id,
    title: m.title,
    caption: m.instagram.caption,
    scheduledTimeIST: timeString,
    scheduledDate: timeString.split(' ')[0],
    scheduledTime: timeString.split(' ')[1],
    localVideoPath: rel(ctx.video),
    localCoverPath: ctx.cover ? rel(ctx.cover) : undefined,
    videoUrl,
    coverUrl,
    containerId,
    status: 'READY_TO_PUBLISH',
    dm: m.dm || undefined,
    manifest: rel(ctx.manifestPath),
    createdAt: new Date().toISOString(),
  });
  ig.writeJson(ig.QUEUE_PATH, queue);
  state.instagram = { queueId: id, containerId, videoUrl };
  save();
  console.log(`✅ Instagram reel #${id} queued for ${timeString}`);
}

function registerDm(m, state, save) {
  const registry = ig.readJson(ig.REGISTRY_PATH, []);
  if (!registry.some((e) => e.queueId === state.instagram.queueId)) {
    registry.push({
      queueId: state.instagram.queueId,
      title: m.title,
      keywords: [m.dm.keyword.toLowerCase(), 'link'],
      youtubeUrl: m.dm.link,
      dmMessage: m.dm.message || buildDmMessage(m.dm.link, m.dm.note),
      replyComment: 'Link aapke DM mein bhej diya hai! Inbox check karo 📩',
    });
    ig.writeJson(ig.REGISTRY_PATH, registry);
  }
  state.dm = { registered: true };
  save();
  console.log(`✅ Auto-DM registered for keyword "${m.dm.keyword}"`);
}

function pushQueue(title) {
  const { syncAndPush } = require('./lib/queue-sync');
  syncAndPush(`feat(instagram): queue reel "${title}"`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--sync')) {
    // Merge the laptop's queue/registry with the cloud copy and push (no upload).
    require('./lib/queue-sync').syncAndPush('chore: sync instagram queue from laptop');
    return;
  }
  const manifestArg = args.find((a) => !a.startsWith('--'));
  if (!manifestArg) {
    console.log('Usage: node scripts/publish-reel.js <manifest.json> [--execute] [--push]');
    console.log('       node scripts/publish-reel.js --sync   (merge laptop queue with GitHub and push)');
    console.log('Start from: data/reels/_TEMPLATE.json');
    process.exit(1);
  }
  const manifestPath = abs(manifestArg);
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestArg}`);
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const statePath = manifestPath.replace(/\.json$/i, '') + '.state.json';
  const state = ig.readJson(statePath, {});
  const save = () => ig.writeJson(statePath, state);

  const result = validate(m, state);
  printPlan(m, state, result);
  result.warnings.forEach((w) => console.log(`⚠️  ${w}`));
  result.errors.forEach((e) => console.log(`❌ ${e}`));
  if (result.errors.length) {
    console.log(`\nFix the ${result.errors.length} error(s) above, then run again.`);
    process.exit(1);
  }
  console.log('\n✅ Manifest passes all checks.');

  if (!args.includes('--execute')) {
    console.log('Dry run only. Add --execute to upload (and --push to hand the Instagram queue to the cloud publisher).');
    return;
  }

  const ctx = { ...result, manifestPath };
  if (m.youtube && !state.youtube) await scheduleYouTube(m, state, ctx, save);
  if (m.instagram && !state.instagram) await queueInstagram(m, state, ctx, save);
  if (m.dm && state.instagram && !state.dm) registerDm(m, state, save);

  if (args.includes('--push')) pushQueue(m.title);
  else if (m.instagram) console.log('\nℹ️ Not pushed. The laptop task will publish it; run again with --push so the cloud publisher can too.');
  console.log('\n🎉 Done.');
}

main().catch((err) => {
  console.error(`💥 ${err.response && err.response.data ? JSON.stringify(err.response.data) : err.message}`);
  process.exit(1);
});
