const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

// Definition of the remaining 3 videos in strategic release order
const REMAINING_VIDEOS = [
  {
    id: 15,
    key: 'antigravity',
    videoPath: path.resolve('antigravity_reel_final.mp4'),
    coverPath: path.resolve('data/shorts/antigravity_cover.jpg'),
    topic: 'Antigravity AI Agent & Google Gemini Quota Hack',
    category: 'AI Coding & Tech Tools',
    targetAudience: 'Developers, Prompt Engineers, Solopreneurs',
    // Scheduled 24h after Video 1 (HyperFrames)
    scheduledDateIST: '08-10-2026',
    scheduledTimeIST: '08-10-2026 13:30:00 IST',
    scheduledTimeUTC: '2026-10-08T08:00:00.000Z',
    youtubeTitle: 'Google Antigravity Quota Reached? ⚡ Free Unlimited Access Hack! #Shorts',
    youtubeDescription: `Ran out of Google Antigravity or Gemini quota while building AI agents? 🤖❌

Here is the quick bypass framework:
1️⃣ Link secondary Gmail / SIM family group
2️⃣ Share workspace credentials across agent environments
3️⃣ Run high-throughput autonomous coding agents zero downtime ke sath! ⚡

Full autonomous agent setup tutorial on the channel! 🚀

#Shorts #AntigravityAI #GoogleAI #ClaudeAI #AIAgents #CodingLife #RatnakarMishra`,
    instagramCaption: `GOOGLE ANTIGRAVITY QUOTA EXHAUSTED? ⚡ Unlimited AI Coding Hack! 🤖

Agar Antigravity mein kaam karte waqt "Data Quota Reached" ka pop-up aa raha hai, toh panic mat karo! 🛑

Here is the exact quick-fix framework:
1️⃣ Secondary Gmail / SIM family setup link karo
2️⃣ Primary workspace permissions extend karo
3️⃣ High-throughput autonomous workflows continue karo zero downtime ke sath! ⚡

Comment "AGENT" below aur main aapko full Antigravity setup guide DM kar dunga! 📩

Save this Reel & share with developers! 📌

---
#Reels #Shorts #AntigravityAI #GoogleAI #AIAgents #CodingLife #RatnakarMishra`,
    tags: [
      'Shorts',
      'Reels',
      'AntigravityAI',
      'GoogleAI',
      'AIAgents',
      'CodingLife',
      'RatnakarMishra'
    ],
    keywords: ['agent', 'quota', 'hack', 'antigravity', 'google'],
    pinnedComment: '⚡ Full Antigravity + Gemini setup guide link: Comment "AGENT" to get direct docs in your DM!'
  },
  {
    id: 16,
    key: 'ai_youtube',
    videoPath: path.resolve('ai_youtube_channel_final_v2.mp4'),
    coverPath: path.resolve('data/shorts/ai_youtube_cover.jpg'),
    topic: 'AI YouTube Automation & Demonetization Policy Fix',
    category: 'YouTube Automation & AI Creators',
    targetAudience: 'Content Creators, Faceless Channel Operators',
    // Scheduled 24h after Video 2
    scheduledDateIST: '09-10-2026',
    scheduledTimeIST: '09-10-2026 13:30:00 IST',
    scheduledTimeUTC: '2026-10-09T08:00:00.000Z',
    youtubeTitle: 'AI YouTube Channels Getting Demonetized? ❌ (The 2026 Truth) #Shorts',
    youtubeDescription: `Making faceless documentary or kids channels using ElevenLabs TTS + OmniFlash AI visuals? 🤖

YouTube's 2026 repetitive content policy is flagging 100% automated slop!
Here is how to inject genuine human editorial value & narrative pacing to guarantee monetization approval.

#Shorts #YouTubeAutomation #FacelessChannel #ElevenLabs #AIVideo #Monetization #RatnakarMishra`,
    instagramCaption: `AI YOUTUBE CHANNELS DEMONETIZED? ❌ The 2026 Policy Fix! 🚨

ElevenLabs voiceover aur OmniFlash / Midjourney clips mix karke YouTube channel monetize karne ka soch rahe ho?

YouTube repetitive content guidelines update ho chuki hain! Agar aap sirf AI visuals stack karoge bina narrative context ke, toh channel demonetize ho jayega.

💡 The Human Editorial Rule:
Har clip mein custom sound design, narrative research, aur original perspective add karo taaki automated slop filter bypass ho sake!

Comment "YOUTUBE" for the full High-Ticket AI Channel Playbook! 📩

Save & share with creators! 📌

---
#Reels #Shorts #YouTubeAutomation #FacelessChannel #ElevenLabs #AIVideo #RatnakarMishra`,
    tags: [
      'Shorts',
      'Reels',
      'YouTubeAutomation',
      'FacelessChannel',
      'ElevenLabs',
      'AIVideo',
      'RatnakarMishra'
    ],
    keywords: ['youtube', 'monetize', 'ai', 'channel', 'elevenlabs'],
    pinnedComment: '📺 Want the 2026 YouTube Automation Monetization Checklist? Comment "YOUTUBE" for the free guide!'
  },
  {
    id: 17,
    key: 'shiprocket',
    videoPath: path.resolve('shiprocket_rto_final.mp4'),
    coverPath: path.resolve('data/shorts/shiprocket_cover.jpg'),
    topic: 'Shiprocket / COD RTO 75% Scam & Delivery Boy Fake Refusals',
    category: 'E-Commerce & Dropshipping',
    targetAudience: 'Shopify Store Owners, D2C Founders, Dropshippers',
    // Scheduled 24h after Video 3 (Saturday Peak)
    scheduledDateIST: '10-10-2026',
    scheduledTimeIST: '10-10-2026 13:30:00 IST',
    scheduledTimeUTC: '2026-10-10T08:00:00.000Z',
    youtubeTitle: 'Shiprocket 75% RTO Trap! 🚚 Delivery Boy Fake Calls Exposed #Shorts',
    youtubeDescription: `75% COD orders returned back as RTO? 📉
Here is the harsh reality of courier logistics and fake doorstep refusal marks in India.

How to implement automated calling verification to drop your RTO from 75% down to 15%!

#Shorts #ShopifyIndia #DropshippingIndia #ReduceRTO #Shiprocket #EcommerceIndia #RatnakarMishra`,
    instagramCaption: `SHIPROCKET 75% RTO KA BADA SACH! 🚚❌ Delivery Boy Fraud Exposed

Aapka 65% se 75% orders RTO ho rahe hain aur courier company bolti hai "Customer Refused"?

Reality: Delivery boy bina doorstep visit kiye fake status update mark kar deta hai.
Aapka ₹120-150 shipping loss, unka double revenue! 💸

💡 Solution:
Order dispatch se pehle 1-minute verification protocol lagao aur logistics tracking par live follow-up rakho.

Comment "RTO" below for the complete Order Verification SOP & Script! 📩

Save & share with fellow e-commerce founders! 📌

---
#Reels #Shorts #ShopifyIndia #DropshippingIndia #ReduceRTO #Shiprocket #RatnakarMishra`,
    tags: [
      'Shorts',
      'Reels',
      'ShopifyIndia',
      'DropshippingIndia',
      'ReduceRTO',
      'Shiprocket',
      'RatnakarMishra'
    ],
    keywords: ['rto', 'shiprocket', 'cod', 'delivery', 'shopify'],
    pinnedComment: '📦 Stop losing money to fake delivery marks: Comment "RTO" to get our 1-minute phone calling verification script!'
  }
];

function uploadToCdn(filePath) {
  console.log(`📤 Uploading ${path.basename(filePath)} to CDN...`);
  const escaped = filePath.replace(/\\/g, '/');
  
  // Try Catbox first (fast & reliable up to 200MB)
  try {
    const cmdCat = `curl.exe -s --max-time 180 -F "reqtype=fileupload" -F "fileToUpload=@${escaped}" https://catbox.moe/user/api.php`;
    const url2 = execSync(cmdCat, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
    if (url2.startsWith('https://')) {
      console.log(`  ✅ Uploaded to Catbox: ${url2}`);
      return url2;
    }
  } catch (e) {
    console.log(`  ⚠️ Catbox notice: ${e.message}. Trying Litterbox...`);
  }

  // Fallback to Litterbox
  try {
    const cmdLitter = `curl.exe -s --max-time 180 -F "reqtype=fileupload" -F "time=72h" -F "fileToUpload=@${escaped}" https://litterbox.catbox.moe/resources/internals/api.php`;
    const url = execSync(cmdLitter, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
    if (url.startsWith('https://')) {
      console.log(`  ✅ Uploaded to Litterbox: ${url}`);
      return url;
    }
  } catch (e) {
    console.error(`  ❌ Litterbox error: ${e.message}`);
  }

  throw new Error(`CDN upload failed for ${filePath}`);
}

async function getYouTubeClient() {
  const tokensPath = path.resolve('config/tokens.json');
  const credentialsPath = path.resolve('config/credentials.json');

  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

  const oauth2Client = new google.auth.OAuth2(
    credentials.youtube.client_id,
    credentials.youtube.client_secret,
    credentials.youtube.redirect_uris?.[0] || 'http://localhost:8080/callback'
  );

  oauth2Client.setCredentials(tokens.youtube);
  oauth2Client.on('tokens', (newTokens) => {
    tokens.youtube = { ...tokens.youtube, ...newTokens };
    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
  });

  return google.youtube({ version: 'v3', auth: oauth2Client });
}

async function scheduleYouTubeShort(youtube, videoConfig) {
  console.log(`\n🔴 [YouTube] Scheduling: ${videoConfig.youtubeTitle}`);
  console.log(`⏰ Target Time: ${videoConfig.scheduledTimeIST} (${videoConfig.scheduledTimeUTC})`);
  console.log(`📁 File: ${videoConfig.videoPath} (${(fs.statSync(videoConfig.videoPath).size / (1024*1024)).toFixed(2)} MB)`);

  const isPast = new Date(videoConfig.scheduledTimeUTC).getTime() <= Date.now();
  const statusBody = isPast
    ? {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
      }
    : {
        privacyStatus: 'private',
        publishAt: videoConfig.scheduledTimeUTC,
        selfDeclaredMadeForKids: false
      };

  console.log(`  Mode: ${isPast ? 'LIVE NOW (Public - target time already passed)' : 'SCHEDULED (Private with publishAt)'}`);

  const res = await youtube.videos.insert({
    part: 'snippet,status',
    notifySubscribers: true,
    requestBody: {
      snippet: {
        title: videoConfig.youtubeTitle,
        description: videoConfig.youtubeDescription,
        tags: videoConfig.tags,
        categoryId: '28',
        defaultLanguage: 'en',
        defaultAudioLanguage: 'hi'
      },
      status: statusBody
    },
    media: {
      body: fs.createReadStream(videoConfig.videoPath)
    }
  });

  const videoId = res.data.id;
  const shortUrl = `https://youtube.com/shorts/${videoId}`;
  console.log(`  🎉 ${isPast ? 'Published Live' : 'Scheduled'} on YouTube! ID: ${videoId} | URL: ${shortUrl}`);

  // Record into youtube_scheduled_shorts.json
  const ytHistoryPath = path.resolve('data/youtube_scheduled_shorts.json');
  let ytHistory = [];
  if (fs.existsSync(ytHistoryPath)) {
    try {
      ytHistory = JSON.parse(fs.readFileSync(ytHistoryPath, 'utf8'));
    } catch (e) {}
  }
  ytHistory.push({
    videoId: videoId,
    title: videoConfig.youtubeTitle,
    scheduledTimeIST: videoConfig.scheduledTimeIST,
    scheduledTimeUTC: videoConfig.scheduledTimeUTC,
    url: shortUrl,
    publishedLive: isPast,
    createdAt: new Date().toISOString()
  });
  fs.writeFileSync(ytHistoryPath, JSON.stringify(ytHistory, null, 2));

  return { videoId, shortUrl };
}

function addToInstagramQueue(videoConfig, cdnVideoUrl, cdnCoverUrl) {
  console.log(`\n📸 [Instagram] Adding to Queue: ${videoConfig.youtubeTitle}`);
  const queuePath = path.resolve('data/instagram_reels_queue.json');
  let queue = [];
  if (fs.existsSync(queuePath)) {
    try {
      queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    } catch (e) {}
  }

  // Check if item already exists by ID
  const existingIdx = queue.findIndex(item => item.id === videoConfig.id);
  const queueItem = {
    id: videoConfig.id,
    title: videoConfig.youtubeTitle.replace(' #Shorts', ''),
    scheduledTimeIST: videoConfig.scheduledTimeIST,
    scheduledDate: videoConfig.scheduledDateIST,
    scheduledTime: videoConfig.scheduledTimeIST.split(' ')[1] || '13:30:00',
    caption: videoConfig.instagramCaption,
    keywords: videoConfig.keywords,
    localVideoPath: path.relative(process.cwd(), videoConfig.videoPath).replace(/\\/g, '/'),
    localCoverPath: path.relative(process.cwd(), videoConfig.coverPath).replace(/\\/g, '/'),
    videoUrl: cdnVideoUrl,
    coverUrl: cdnCoverUrl,
    status: 'READY_TO_PUBLISH',
    createdAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    queue[existingIdx] = { ...queue[existingIdx], ...queueItem };
    console.log(`  🔄 Updated existing queue entry (ID: ${videoConfig.id})`);
  } else {
    queue.push(queueItem);
    console.log(`  ✅ Appended new queue entry (ID: ${videoConfig.id})`);
  }

  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  return queueItem;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || (!args.includes('--execute') && !args.includes('--all'));
  const isYouTubeOnly = args.includes('--youtube-only');
  const isInstagramOnly = args.includes('--instagram-only');

  console.log('🚀==============================================================🚀');
  console.log('   VIRAL SHORTS / REELS SCHEDULING PIPELINE (REMAINING 3 VIDEOS)  ');
  console.log('🚀==============================================================🚀\n');

  console.log('📊 STRATEGIC CADENCE ANALYSIS & RANKING RUNWAY:');
  console.log('• Video 1 (HyperFrames / Remotion) was published LIVE today: 07-Oct 13:45 IST.');
  console.log('• YouTube algorithm requires 18-24 hours per Short to seed into test feeds.');
  console.log('• Consecutive same-day uploads can cannibalize browse impressions.');
  console.log('• Strategic 24-Hour Spacing Blueprint (Peak Lunch Window @ 01:30 PM IST):\n');

  REMAINING_VIDEOS.forEach((v, idx) => {
    console.log(`  [Video ${idx + 2} of 4] ID ${v.id}: ${v.youtubeTitle}`);
    console.log(`    📁 File: ${path.basename(v.videoPath)}`);
    console.log(`    🎯 Target Slot: ${v.scheduledTimeIST} (UTC: ${v.scheduledTimeUTC})`);
    console.log(`    💡 Category: ${v.category} | Audience: ${v.targetAudience}`);
    console.log(`    🏷️  Tags (${v.tags.length}): ${v.tags.join(', ')}`);
    console.log('');
  });

  if (isDryRun) {
    console.log('ℹ️  MODE: DRY-RUN (Preview Only). No changes were made.');
    console.log('👉 To execute YouTube & Instagram scheduling for all 3 videos, run:');
    console.log('   node scripts/schedule_remaining_3_videos.js --execute\n');
    console.log('👉 For YouTube only:');
    console.log('   node scripts/schedule_remaining_3_videos.js --execute --youtube-only\n');
    console.log('👉 For Instagram only:');
    console.log('   node scripts/schedule_remaining_3_videos.js --execute --instagram-only\n');
    return;
  }

  console.log('⚡ STARTING FULL PIPELINE EXECUTION...\n');

  let youtubeClient = null;
  if (!isInstagramOnly) {
    youtubeClient = await getYouTubeClient();
  }

  for (let i = 0; i < REMAINING_VIDEOS.length; i++) {
    const v = REMAINING_VIDEOS[i];
    console.log(`\n========================================================`);
    console.log(`🎬 Processing Video ${i + 1}/${REMAINING_VIDEOS.length}: ${v.key}`);
    console.log(`========================================================`);

    // Verify files exist
    if (!fs.existsSync(v.videoPath)) {
      throw new Error(`Video file not found: ${v.videoPath}`);
    }
    if (!fs.existsSync(v.coverPath)) {
      throw new Error(`Cover file not found: ${v.coverPath}`);
    }

    // 1. YouTube Scheduling
    if (!isInstagramOnly && youtubeClient) {
      try {
        await scheduleYouTubeShort(youtubeClient, v);
      } catch (err) {
        console.error(`❌ Failed to schedule YouTube for ${v.key}:`, err.response?.data || err.message);
      }
    }

    // 2. Instagram CDN & Queue Scheduling
    if (!isYouTubeOnly) {
      try {
        const cdnVideo = uploadToCdn(v.videoPath);
        const cdnCover = uploadToCdn(v.coverPath);
        addToInstagramQueue(v, cdnVideo, cdnCover);
      } catch (err) {
        console.error(`❌ Failed to schedule Instagram for ${v.key}:`, err.message);
      }
    }
  }

  console.log('\n🎉 ALL 3 VIDEOS HAVE BEEN PROCESSED INTO THE SCHEDULING PIPELINE!');
}

main().catch(err => {
  console.error('Fatal Pipeline Error:', err);
  process.exit(1);
});
