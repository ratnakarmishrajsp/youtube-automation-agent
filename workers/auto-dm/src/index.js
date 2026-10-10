import { privacyPolicyHtml, termsOfServiceHtml, dataDeletionHtml } from './pages.js';
import { logEvent, processWebhookPayload } from './handlers.js';
import { runPoll } from './poller.js';

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
  // Cron trigger (see wrangler.toml): polls comments + DM replies every minute.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runPoll(env));
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

    // 3. Serve PDF from KV
    const pdfMatch = path.match(/^\/pdf\/([a-zA-Z0-9_-]+)$/);
    if (pdfMatch) {
      const slug = pdfMatch[1];
      if (!env.AUTO_DM) {
        return new Response('KV binding AUTO_DM not configured', { status: 500 });
      }

      const pdfData = await env.AUTO_DM.get(`pdf:${slug}`, { type: 'arrayBuffer' });
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

      // Always log incoming webhook hit to KV
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
      ctx.waitUntil(processWebhookPayload(rawBody, env, workerHost));

      // Immediate 200 acknowledgment required by Meta
      return new Response('EVENT_RECEIVED', { status: 200 });
    }

    // 6. Stats endpoint
    if (path === '/stats') {
      const key = url.searchParams.get('key');
      if (!env.STATS_KEY || key !== env.STATS_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }

      if (!env.AUTO_DM) {
        return new Response(JSON.stringify({ error: 'KV not bound' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const list = await env.AUTO_DM.list({ prefix: 'log:', limit: 50 });
      const logs = [];
      for (const item of list.keys) {
        const val = await env.AUTO_DM.get(item.name, { type: 'json' });
        if (val) logs.push({ key: item.name, ...val });
      }

      return new Response(JSON.stringify({ total: logs.length, logs }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 404 Fallback
    return new Response('Not Found', { status: 404 });
  }
};
