// Links a reel that Ratnakar posted from his phone to the queue + auto-DM, and
// pushes it so the Cloudflare worker starts answering comments right away.
//
//   node scripts/link-phone-post.js 20                                  find it by the caption's first line
//   node scripts/link-phone-post.js 20 https://www.instagram.com/reel/XXXX/   if the caption was changed
require('dotenv').config();
const ig = require('./lib/instagram');
const { registerPublishedReel } = require('./lib/dm-registry');
const { syncAndPush } = require('./lib/queue-sync');

const shortcode = (url) => (String(url || '').match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/) || [])[1];

async function main() {
  const [idArg, url] = process.argv.slice(2);
  const id = Number(idArg);
  if (!id) {
    console.log('Usage: node scripts/link-phone-post.js <queueId> [instagram reel link]');
    process.exit(1);
  }

  const queue = ig.readJson(ig.QUEUE_PATH, []);
  const reel = queue.find((r) => r.id === id);
  if (!reel) throw new Error(`Reel #${id} is not in the Instagram queue`);
  if (reel.status === 'PUBLISHED') {
    console.log(`ℹ️ Reel #${id} is already linked: ${reel.permalink}`);
  } else {
    const feed = await ig.recentMedia(25);
    const code = shortcode(url);
    const live = code ? feed.find((m) => shortcode(m.permalink) === code) : await ig.findLiveMatch(reel, feed);
    if (!live) {
      throw new Error(code
        ? `No recent post with link ${url} on @ratnakarcontent`
        : 'Post not found by its first caption line — run again with the reel link as the second argument');
    }
    Object.assign(reel, {
      status: 'PUBLISHED',
      publishedMediaId: live.id,
      permalink: live.permalink,
      publishedAt: live.timestamp,
      manualPost: true,
    });
    delete reel.processingStartedAt;
    delete reel.lastError;
    delete reel.lastErrorAt;
    ig.writeJson(ig.QUEUE_PATH, queue);
    console.log(`✅ Reel #${id} linked to ${live.permalink}`);
    if (registerPublishedReel(reel)) console.log('✅ Auto-DM registry updated');
    else console.log('ℹ️ This reel has no auto-DM (no "dm" block in its manifest)');
  }

  syncAndPush(`chore: link phone-posted reel #${id}`);
  console.log('🎉 Auto-DM goes live within ~5 minutes (worker refreshes the registry from GitHub).');
}

main().catch((err) => {
  console.error(`💥 ${err.message}`);
  process.exit(1);
});
