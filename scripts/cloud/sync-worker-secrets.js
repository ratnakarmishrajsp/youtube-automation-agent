require('dotenv').config();

const accountId = 'be7df7160222036acbc96121c6e89bd1';
const scriptName = 'ratnakar-auto-dm';

async function putSecret(name, text) {
  if (!text) {
    console.log(`Skipping ${name}: value is empty`);
    return false;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/secrets`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, text, type: 'secret_text' })
  });
  const data = await res.json();
  if (data.success) {
    console.log(`✅ Secret "${name}" successfully set on Cloudflare Worker.`);
    return true;
  } else {
    console.error(`❌ Failed to set secret "${name}":`, data.errors);
    return false;
  }
}

async function main() {
  await putSecret('WEBHOOK_VERIFY_TOKEN', process.env.WEBHOOK_VERIFY_TOKEN);
  await putSecret('STATS_KEY', process.env.STATS_KEY);
  await putSecret('IG_ACCESS_TOKEN', process.env.INSTAGRAM_ACCESS_TOKEN);

  if (process.env.INSTAGRAM_APP_SECRET) {
    await putSecret('IG_APP_SECRET', process.env.INSTAGRAM_APP_SECRET);
  } else {
    console.log('ℹ️ INSTAGRAM_APP_SECRET not provided yet. Will be set once provided.');
  }
}

main().catch(console.error);
