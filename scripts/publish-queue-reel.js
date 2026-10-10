require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com/v20.0';
const token = process.env.INSTAGRAM_ACCESS_TOKEN;
const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

const targetId = parseInt(process.argv[2] || '1', 10);
const queuePath = path.join(__dirname, '..', 'data', 'instagram_reels_queue.json');

async function publishReel() {
  console.log(`====================================================`);
  console.log(`🚀 PUBLISHING SCHEDULED REEL #${targetId} TO INSTAGRAM`);
  console.log(`====================================================\n`);

  if (!fs.existsSync(queuePath)) {
    throw new Error(`Queue file not found at ${queuePath}`);
  }

  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const reel = queue.find(r => r.id === targetId);

  if (!reel) {
    throw new Error(`Reel with ID ${targetId} not found in queue!`);
  }

  if (reel.status === 'PUBLISHED') {
    console.log(`ℹ️ Reel #${targetId} is already PUBLISHED. Skipping.`);
    return;
  }

  console.log(`📦 Title: ${reel.title}`);
  console.log(`🆔 Container ID: ${reel.containerId}`);
  console.log(`⏰ Scheduled IST: ${reel.scheduledTimeIST}`);

  // Step 1: Check status
  console.log('\n🔍 Verifying container status before publication...');
  const statusRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${reel.containerId}?fields=status_code,status&access_token=${token}`);
  const statusData = await statusRes.json();
  console.log('📊 Status:', statusData);

  if (statusData.status_code !== 'FINISHED' && statusData.status !== 'FINISHED') {
    throw new Error(`Container is not ready: ${JSON.stringify(statusData)}`);
  }

  // Step 2: Publish
  console.log('\n🚀 Triggering media_publish...');
  const pubRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${accountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: reel.containerId,
      access_token: token
    })
  });

  const pubData = await pubRes.json();
  if (pubData.error) {
    throw new Error(`Publish failed: ${pubData.error.message}`);
  }

  console.log(`🎉 Published Successfully! Media ID: ${pubData.id}`);

  // Step 3: Fetch link
  let permalink = 'https://www.instagram.com/ratnakarcontent/reels/';
  try {
    const mRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${pubData.id}?fields=permalink&access_token=${token}`);
    const mData = await mRes.json();
    if (mData.permalink) {
      permalink = mData.permalink;
    }
  } catch {
    // keep the profile URL fallback
  }

  reel.status = 'PUBLISHED';
  reel.publishedMediaId = pubData.id;
  reel.permalink = permalink;
  reel.publishedAt = new Date().toISOString();

  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));

  console.log(`🔗 Live Reel URL: ${permalink}`);
  console.log('====================================================\n');
}

publishReel().catch(err => {
  console.error('❌ Error publishing queued reel:', err.message);
  process.exit(1);
});
