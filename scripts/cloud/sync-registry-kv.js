require('dotenv').config();
const fs = require('fs');

async function syncRegistry() {
  const reg = fs.readFileSync('data/auto_dm_registry.json', 'utf8');
  const accountId = 'be7df7160222036acbc96121c6e89bd1';
  const kvId = '290a436ac8ff4457af26a3dd1ba500a9';
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/cfg:registry`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: reg
  });
  const data = await res.json();
  if (data.success) {
    console.log('✅ Synchronized updated registry into Cloudflare KV cfg:registry');
  } else {
    console.error('Failed to sync registry:', data.errors);
  }
}

syncRegistry().catch(console.error);
