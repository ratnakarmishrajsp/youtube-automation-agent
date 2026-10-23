import { privacyPolicyHtml, termsOfServiceHtml, dataDeletionHtml } from './pages.js';
import { logEvent } from './handlers.js';
import { stateStub } from './state.js';

export { AutoDmState } from './state.js';

const GUIDES_URL = 'https://raw.githubusercontent.com/ratnakarmishrajsp/youtube-automation-agent/master/docs/guides';

// A guide with no exported page yet: one button to its PDF.
function guideFallbackHtml(slug) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your guide - Ratnakar Mishra</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0A0F1D;color:#E2E8F0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px;text-align:center}
a{display:inline-block;margin-top:18px;padding:14px 22px;border-radius:12px;background:#00FF66;color:#0A0F1D;font-weight:800;text-decoration:none}
p{opacity:.8;font-size:14px;max-width:360px;margin:16px auto 0}</style></head>
<body><div><h2>Your guide is ready 📄</h2><a href="/pdf/${slug}">Open the PDF</a>
<p>If it doesn't open inside Instagram, tap ⋮ (top right) → "Open in browser".</p></div></body></html>`;
}

/**
 * Verify Meta HMAC-SHA256 signature
 */
async function verifySignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const signatureHex = signatureHeader.slice('sha256='.length);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const expectedHex = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return expectedHex === signatureHex;
}

export default {
  // Cron trigger (see wrangler.toml): polls comments + DM replies inside the state object.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(stateStub(env).poll());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const workerHost = url.host;

    // 1. Health check
    if (path === '/health') {
      return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    // 2. Legal pages
    const contactEmail = env.CONTACT_EMAIL || 'ratnakarmishrajsp@gmail.com';
    if (path === '/privacy') {
      return new Response(privacyPolicyHtml(contactEmail), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    if (path === '/terms') {
      return new Response(termsOfServiceHtml(contactEmail), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    if (path === '/data-deletion') {
      return new Response(dataDeletionHtml(contactEmail), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 3a. Guide as a web page (what the DM links: Instagram's Android in-app browser
    // cannot open PDFs). Pages live in the repo under docs/guides/<slug>.html.
    const guideMatch = path.match(/^\/guide\/([a-zA-Z0-9_-]+)$/);
    if (guideMatch) {
      const slug = guideMatch[1];
      const res = await fetch(`${GUIDES_URL}/${slug}.html`, { cf: { cacheTtl: 300 } });
      const html = res.ok ? await res.text() : guideFallbackHtml(slug);
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // 3b. Serve PDF from KV, else the copy in the repo (docs/guides/<slug>.pdf)
    const pdfMatch = path.match(/^\/pdf\/([a-zA-Z0-9_-]+)$/);
    if (pdfMatch) {
      const slug = pdfMatch[1];
      let pdfData = env.AUTO_DM ? await env.AUTO_DM.get(`pdf:${slug}`, { type: 'arrayBuffer' }) : null;
      if (!pdfData) {
        const res = await fetch(`${GUIDES_URL}/${slug}.pdf`, { cf: { cacheTtl: 3600 } });
        if (res.ok) pdfData = await res.arrayBuffer();
      }
      if (!pdfData) {
        return new Response(`PDF "${slug}" not found or not approved yet.`, { status: 404 });
      }

      return new Response(pdfData, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${slug}.pdf"`,
          'Cache-Control': 'public, max-age=86400'
        }
      });
    }

    // 4. Webhook verification (GET)
    if (path === '/webhook' && request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      const expectedToken = env.WEBHOOK_VERIFY_TOKEN;
      if (mode === 'subscribe' && token === expectedToken && challenge) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Verification token mismatch', { status: 403 });
    }

    // 5. Webhook event receiver (POST)
    if (path === '/webhook' && request.method === 'POST') {
      const rawBody = await request.text();
      const sigHeader = request.headers.get('X-Hub-Signature-256');

      let valid = true;
      if (env.IG_APP_SECRET) {
        valid = await verifySignature(env.IG_APP_SECRET, rawBody, sigHeader);
      }

      // Log every webhook hit (buffered; reaches KV with the poller's next flush)
      ctx.waitUntil(logEvent(env, {
        type: 'webhook_received',
        hasSig: Boolean(sigHeader),
        sigValid: valid,
        bodySnippet: rawBody.slice(0, 300)
      }));

      if (env.IG_APP_SECRET && !valid) {
        return new Response('Invalid signature', { status: 401 });
      }

      // Background processing via ctx.waitUntil
      ctx.waitUntil(stateStub(env).webhook(rawBody, workerHost));

      // Immediate 200 acknowledgment required by Meta
      return new Response('EVENT_RECEIVED', { status: 200 });
    }

    // 6. Stats endpoint
    if (path === '/stats') {
      const key = url.searchParams.get('key');
      if (!env.STATS_KEY || key !== env.STATS_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }

      const logs = await stateStub(env).recentLogs(50);

      return new Response(JSON.stringify({ total: logs.length, logs }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 7. Admin (same key as /stats): read one state key, copy KV records now, restore lost pending checks
    if (path === '/state' || path === '/admin/restore-pending' || path === '/admin/import') {
      if (!env.STATS_KEY || url.searchParams.get('key') !== env.STATS_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }
      const stub = stateStub(env);
      let body = null;
      if (path === '/state') body = await stub.peek(url.searchParams.get('k') || '');
      else if (request.method !== 'POST') return new Response('POST only', { status: 405 });
      else if (path === '/admin/import') body = await stub.importNow();
      else body = await stub.restorePending(await request.json());
      return new Response(JSON.stringify(body ?? null, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // 404 Fallback
    return new Response('Not Found', { status: 404 });
  }
};
