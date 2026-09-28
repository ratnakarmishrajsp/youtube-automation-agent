require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com/v20.0';
const token = process.env.INSTAGRAM_ACCESS_TOKEN;
const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

const BASE_DIR = path.join(__dirname, '..', 'data', 'shorts', 'meta_scale_1lakh');
const queuePath = path.join(__dirname, '..', 'data', 'instagram_reels_queue.json');
const autoDmPath = path.join(__dirname, '..', 'data', 'auto_dm_registry.json');

const REEL_CONFIG = {
  id: 6,
  title: 'Stop Duplicating Campaigns! (The Scaling Myth Exposed)',
  videoFile: 'Reel_1_Scaling_Myth_Final.mp4',
  coverFile: 'Reel_1_Cover.jpg',
  sourceCoverFile: 'Reel_1_Cover_Generated.jpg',
  scheduledTimeIST: '2026-09-28 20:15:00 IST',
  scheduledDate: '28-09-2026',
  scheduledTime: '20:15:00',
  caption: `STOP DUPLICATING CAMPAIGNS! ❌ Meta Ads Scaling Myth Exposed!

Winning ad set dekhte hi usko 5 se 10 baar duplicate kar dete ho? Yeh sabse badi galti hai jo aapka ROAS crash karti hai! 📉

💡 THE TRUTH ABOUT DUPLICATION:
Jab aap identical ad sets duplicate karte ho, toh wo bahar kisi aur se nahi, balki AAPKE APNE HI AD SETS se compete karte hain (Auction Overlap / Audience Cannibalization)!
Result: CPM skyrocket ho jata hai aur Meta confuse hokar delivery band kar deta hai.

🚀 THE REAL WAY TO SCALE:
1️⃣ Horizontal Creative Scaling: Same audience ko naye dynamic hooks aur video formats do.
2️⃣ Budget Scaling (CBO): Incremental 15-20% budget pump ya cost-cap testing karo.

🔥 Want the complete step-by-step Meta Ads Scaling Masterclass & Blueprint?
👉 Comment "LINK" below and I will send the full video tutorial directly to your DMs! 📩

Save this Reel for your next scaling campaign & share with media buyers scaling their e-commerce stores! 📌

---
#metaads #facebookads #metaadsmarketing #adscaling #dropshippingindia #ecommerceindia #mediabuying #performancemarketing #businessscaling #roas #adsexpert #digitalmarketing #shopifyindia #ratnakarmishra`,
  keywords: ['link', 'scale', 'duplicate', 'campaign', 'meta', 'ads'],
  youtubeUrl: 'https://youtu.be/qYhmP1ZkCmM',
  dmMessage: `Hey! 👋 As promised, here is the full Meta Ads Daily Spending Limit & Scaling masterclass:\n👉 https://youtu.be/qYhmP1ZkCmM\n\nWatch it and let me know if you have any questions! 🚀`,
  replyComment: 'Link sent to your DM! Check your inbox 📩'
};

function uploadToCatbox(filePath) {
  console.log(`📤 Uploading ${path.basename(filePath)} to Catbox CDN...`);
  const escaped = filePath.replace(/\\/g, '/');
  // Try Catbox first, fallback to litterbox if needed
  try {
    const cmd = `curl.exe -s -F "reqtype=fileupload" -F "fileToUpload=@${escaped}" https://catbox.moe/user/api.php`;
    const url = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
    if (url.startsWith('https://')) {
      console.log(`✅ Uploaded to Catbox: ${url}`);
      return url;
    }
    console.log(`⚠️ Catbox response unexpected (${url}), trying Litterbox...`);
  } catch (e) {
    console.log(`⚠️ Catbox error (${e.message}), trying Litterbox...`);
  }

  const cmd2 = `curl.exe -s -F "reqtype=fileupload" -F "time=72h" -F "fileToUpload=@${escaped}" https://litterbox.catbox.moe/resources/internals/api.php`;
  const url2 = execSync(cmd2, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
  if (!url2.startsWith('https://')) {
    throw new Error(`CDN upload failed: ${url2}`);
  }
  console.log(`✅ Uploaded to Litterbox: ${url2}`);
  return url2;
}

async function main() {
  console.log('====================================================');
  console.log('🎬 PREPARING REEL #6 WITH APPROVED THUMBNAIL COVER');
  console.log('====================================================\n');

  // 1. Ensure local cover files are standardized
  const sourceCover = path.join(BASE_DIR, REEL_CONFIG.sourceCoverFile);
  const targetCover = path.join(BASE_DIR, REEL_CONFIG.coverFile);
  const targetThumb = path.join(BASE_DIR, 'Reel_1_Thumbnail.jpg');

  if (fs.existsSync(sourceCover)) {
    fs.copyFileSync(sourceCover, targetCover);
    fs.copyFileSync(sourceCover, targetThumb);
    console.log(`✅ Standardized local cover paths:\n   - ${targetCover}\n   - ${targetThumb}`);
  }

  const videoPath = path.join(BASE_DIR, REEL_CONFIG.videoFile);
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found at: ${videoPath}`);
  }

  // 2. Upload video and cover to CDN
  const coverUrl = uploadToCatbox(targetCover);
  const videoUrl = uploadToCatbox(videoPath);

  // 3. Create Meta Media Container with cover
  console.log(`\n📦 Creating Instagram Media Container via Graph API...`);
  console.log(`   - Video URL: ${videoUrl}`);
  console.log(`   - Cover URL: ${coverUrl}`);

  const createRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${accountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: videoUrl,
      cover_url: coverUrl,
      caption: REEL_CONFIG.caption,
      access_token: token
    })
  });

  const createData = await createRes.json();
  if (createData.error) {
    throw new Error('Container creation failed: ' + JSON.stringify(createData.error));
  }

  const containerId = createData.id;
  console.log(`✅ Container Created! ID: ${containerId}`);

  // 4. Poll until transcode is FINISHED
  console.log(`⏳ Waiting for Instagram to transcode video and process thumbnail cover...`);
  let isReady = false;
  for (let i = 0; i < 35; i++) {
    await new Promise(r => setTimeout(r, 6000));
    try {
      const sRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${containerId}?fields=status_code,status&access_token=${token}`);
      const sData = await sRes.json();
      console.log(`📊 Poll [${i + 1}/35]: Status = ${sData.status_code || sData.status}`);
      if (sData.status_code === 'FINISHED' || sData.status === 'FINISHED') {
        isReady = true;
        break;
      }
      if (sData.status_code === 'ERROR') {
        throw new Error('Transcode error: ' + JSON.stringify(sData));
      }
    } catch (e) {
      console.log(`⚠️ Poll attempt ${i + 1} notice: ${e.message}`);
    }
  }

  if (!isReady) {
    throw new Error('Transcode timed out on Meta servers.');
  }

  // 5. Update data/instagram_reels_queue.json
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const existingIdx = queue.findIndex(r => r.id === REEL_CONFIG.id);

  const queueEntry = {
    id: REEL_CONFIG.id,
    title: REEL_CONFIG.title,
    containerId: containerId,
    videoUrl: videoUrl,
    coverUrl: coverUrl,
    caption: REEL_CONFIG.caption,
    scheduledTimeIST: REEL_CONFIG.scheduledTimeIST,
    scheduledDate: REEL_CONFIG.scheduledDate,
    scheduledTime: REEL_CONFIG.scheduledTime,
    status: 'READY_TO_PUBLISH',
    keywords: REEL_CONFIG.keywords,
    youtubeUrl: REEL_CONFIG.youtubeUrl,
    localVideoPath: `data/shorts/meta_scale_1lakh/${REEL_CONFIG.videoFile}`,
    localCoverPath: `data/shorts/meta_scale_1lakh/${REEL_CONFIG.coverFile}`
  };

  if (existingIdx >= 0) {
    queue[existingIdx] = queueEntry;
  } else {
    queue.push(queueEntry);
  }

  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  console.log(`\n✅ Updated ${queuePath} with Reel #6 (READY_TO_PUBLISH).`);

  // 6. Update data/auto_dm_registry.json
  const autoDm = JSON.parse(fs.readFileSync(autoDmPath, 'utf8'));
  const autoDmIdx = autoDm.findIndex(d => d.title === REEL_CONFIG.title);
  const autoDmEntry = {
    containerId: containerId,
    title: REEL_CONFIG.title,
    keywords: REEL_CONFIG.keywords,
    youtubeUrl: REEL_CONFIG.youtubeUrl,
    dmMessage: REEL_CONFIG.dmMessage,
    replyComment: REEL_CONFIG.replyComment
  };

  if (autoDmIdx >= 0) {
    autoDm[autoDmIdx] = { ...autoDm[autoDmIdx], ...autoDmEntry };
  } else {
    autoDm.push(autoDmEntry);
  }
  fs.writeFileSync(autoDmPath, JSON.stringify(autoDm, null, 2));
  console.log(`✅ Updated ${autoDmPath} for keyword "LINK" responses.`);

  console.log('\n====================================================');
  console.log('🎉 REEL #6 WITH CUSTOM COVER IS READY TO PUBLISH!');
  console.log('🆔 Container ID:', containerId);
  console.log('🖼️ Cover URL:', coverUrl);
  console.log('🎥 Video URL:', videoUrl);
  console.log('====================================================\n');
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
