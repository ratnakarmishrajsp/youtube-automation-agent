// Shared YouTube Data API helpers (OAuth from config/credentials.json + config/tokens.json).
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const ROOT = path.join(__dirname, '..', '..');
const TOKENS_PATH = path.join(ROOT, 'config', 'tokens.json');
const CREDENTIALS_PATH = path.join(ROOT, 'config', 'credentials.json');

function youtubeClient() {
  if (!fs.existsSync(TOKENS_PATH) || !fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('config/tokens.json or config/credentials.json missing — run: node modern-auth.js');
  }
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const auth = new google.auth.OAuth2(
    credentials.youtube.client_id,
    credentials.youtube.client_secret,
    (credentials.youtube.redirect_uris && credentials.youtube.redirect_uris[0]) || 'http://localhost:8080/callback'
  );
  auth.setCredentials(tokens.youtube);
  auth.on('tokens', (fresh) => {
    tokens.youtube = { ...tokens.youtube, ...fresh };
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  });
  return google.youtube({ version: 'v3', auth });
}

// Uploads as private with publishAt, so YouTube itself publishes on time.
async function uploadScheduled({ file, title, description, tags, categoryId = '28', publishAt }) {
  const youtube = youtubeClient();
  const res = await youtube.videos.insert({
    part: 'snippet,status',
    notifySubscribers: true,
    requestBody: {
      snippet: { title, description, tags, categoryId },
      status: { privacyStatus: 'private', publishAt, selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(file) },
  });
  return res.data.id;
}

async function setThumbnail(videoId, file) {
  const youtube = youtubeClient();
  await youtube.thumbnails.set({ videoId, media: { body: fs.createReadStream(file) } });
}

async function recentUploads(max = 25) {
  const youtube = youtubeClient();
  const channel = await youtube.channels.list({ part: 'contentDetails', mine: true });
  const uploads = channel.data.items[0].contentDetails.relatedPlaylists.uploads;
  const list = await youtube.playlistItems.list({ part: 'contentDetails', playlistId: uploads, maxResults: max });
  const ids = list.data.items.map((i) => i.contentDetails.videoId);
  if (!ids.length) return [];
  const videos = await youtube.videos.list({ part: 'snippet,statistics,contentDetails,status', id: ids.join(',') });
  return videos.data.items;
}

module.exports = { youtubeClient, uploadScheduled, setThumbnail, recentUploads };
