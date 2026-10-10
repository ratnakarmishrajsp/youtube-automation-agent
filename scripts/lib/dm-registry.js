// Keeps data/auto_dm_registry.json in sync with the reel queue so the auto-DM
// monitor knows the Instagram media ID of every reel that has a comment CTA.
const { REGISTRY_PATH, readJson, writeJson } = require('./instagram');

function buildDmMessage(link, extra) {
  return `Hey! 👋 Aapne comment kiya tha, ye raha link:\n👉 ${link}${extra ? `\n\n${extra}` : ''}\n\nKoi sawaal ho to reply karo! 🚀`;
}

// Called after a reel goes live. Fills mediaId/permalink on the registry entry
// linked to this queue id, or creates one when the queue item carries a `dm` block.
function registerPublishedReel(reel) {
  const registry = readJson(REGISTRY_PATH, []);
  let entry = registry.find((e) => e.queueId === reel.id);
  if (!entry && reel.dm && reel.dm.keyword && reel.dm.link) {
    entry = {
      queueId: reel.id,
      title: reel.title,
      keywords: [reel.dm.keyword.toLowerCase(), 'link'],
      youtubeUrl: reel.dm.link,
      dmMessage: reel.dm.message || buildDmMessage(reel.dm.link),
      // Having followGate marks a reel as "new system": the worker watches it forever.
      followGate: reel.dm.followGate || 'none',
      pdfSlug: reel.dm.pdf ? reel.dm.pdf.slug : null,
      pdfTitle: reel.dm.pdf ? reel.dm.pdf.title : null,
    };
    registry.push(entry);
  }
  if (!entry) return false;
  entry.mediaId = reel.publishedMediaId;
  entry.permalink = reel.permalink;
  entry.publishedAt = reel.publishedAt;
  writeJson(REGISTRY_PATH, registry);
  return true;
}

module.exports = { registerPublishedReel, buildDmMessage };
