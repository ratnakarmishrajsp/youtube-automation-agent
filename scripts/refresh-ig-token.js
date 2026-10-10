require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');

async function refreshInstagramToken() {
  const currentToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!currentToken) {
    throw new Error('INSTAGRAM_ACCESS_TOKEN is missing from .env');
  }

  console.log('🔄 Requesting token refresh from Instagram Graph API...');
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Instagram token refresh failed: ${data.error.message}`);
  }

  const newToken = data.access_token;
  const expiresInSeconds = data.expires_in;
  const expiresInDays = Math.round(expiresInSeconds / 86400);

  if (!newToken) {
    throw new Error('No access_token returned by refresh endpoint');
  }

  // 1. Update .env
  let envContent = fs.readFileSync(ENV_PATH, 'utf8');
  if (envContent.includes('INSTAGRAM_ACCESS_TOKEN=')) {
    envContent = envContent.replace(/INSTAGRAM_ACCESS_TOKEN=.*/, `INSTAGRAM_ACCESS_TOKEN=${newToken}`);
  } else {
    envContent += `\nINSTAGRAM_ACCESS_TOKEN=${newToken}\n`;
  }
  fs.writeFileSync(ENV_PATH, envContent, 'utf8');
  console.log(`✅ Updated INSTAGRAM_ACCESS_TOKEN in .env (valid for ~${expiresInDays} days)`);

  // 2. Update Cloudflare Worker secret
  const accountId = 'be7df7160222036acbc96121c6e89bd1';
  const scriptName = 'ratnakar-auto-dm';
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;

  if (cfToken) {
    try {
      const secretUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/secrets`;
      const secretRes = await fetch(secretUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${cfToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'IG_ACCESS_TOKEN', text: newToken, type: 'secret_text' })
      });
      const secretData = await secretRes.json();
      if (secretData.success) {
        console.log('✅ Updated IG_ACCESS_TOKEN in Cloudflare Worker secrets');
      } else {
        console.warn('⚠️ Cloudflare secret update returned error:', secretData.errors);
      }
    } catch (cfErr) {
      console.warn('⚠️ Could not update Cloudflare secret:', cfErr.message);
    }
  }

  // 3. Update GitHub secret if gh is installed
  try {
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
    const repo = origin.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
    execFileSync('gh', ['secret', 'set', 'INSTAGRAM_ACCESS_TOKEN', '--repo', repo], {
      input: newToken,
      encoding: 'utf8',
      cwd: ROOT_DIR,
      stdio: ['pipe', 'ignore', 'ignore']
    });
    console.log('✅ Updated INSTAGRAM_ACCESS_TOKEN in GitHub Actions secrets');
  } catch {
    console.log('ℹ️ GitHub secret not updated (gh CLI not authenticated or not installed)');
  }

  console.log(`\n🎉 Instagram token successfully refreshed! New expiry in ${expiresInDays} days.`);
  return { expiresInDays };
}

if (require.main === module) {
  refreshInstagramToken().catch((err) => {
    console.error(`💥 Refresh error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { refreshInstagramToken };
