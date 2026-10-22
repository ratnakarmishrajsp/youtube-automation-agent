// Writes docs/guides/<slug>.html: the guide as a phone-friendly web page. Instagram's
// in-app browser (Android) cannot open PDFs, so the auto-DM links this page through the
// worker (/guide/<slug>), and the page offers the PDF as a download.
//
//   node scripts/pdf/export-guide-page.js <slug> [<slug> ...]
//
// Reads data/pdfs/<slug>.guide.json (the approved guide). Copies data/pdfs/<slug>.pdf to
// docs/guides/ only with --with-pdf (the worker serves older PDFs from KV).
const fs = require('fs');
const path = require('path');
const { buildHtmlFromTemplate } = require('./make-guide');

const ROOT = path.resolve(__dirname, '../..');
const PDF_DIR = path.join(ROOT, 'data', 'pdfs');
const OUT_DIR = path.join(ROOT, 'docs', 'guides');
const WORKER = 'https://ratnakar-auto-dm.ratnakar-auto-dm.workers.dev';
const DEFAULT_VIDEO = 'https://www.youtube.com/@ratnakarmishra06';

// The video link a manifest gives this guide, if any.
function videoUrlFor(slug) {
  const dir = path.join(ROOT, 'data', 'reels');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.state.json'))) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (m.dm?.pdf?.slug === slug) return m.dm.pdf.videoUrl || m.dm.link || DEFAULT_VIDEO;
    } catch {
      // skip unreadable manifests
    }
  }
  return DEFAULT_VIDEO;
}

const MOBILE_HEAD = `
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { padding: 18px 16px 96px; font-size: 16px; }
    .page-container { max-width: 680px; }
    .download-bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
      background: rgba(10, 15, 29, 0.96); border-top: 1px solid rgba(255, 255, 255, 0.12); text-align: center; }
    .download-bar a { display: inline-block; width: 100%; max-width: 420px; padding: 14px 18px; border-radius: 12px;
      background: #00FF66; color: #0A0F1D; font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 16px; text-decoration: none; }
    @media (max-width: 600px) {
      body { font-size: 15.5px; }
      .header-banner { flex-wrap: wrap; gap: 10px; }
    }
  </style>`;

function exportPage(slug, withPdf) {
  const guidePath = path.join(PDF_DIR, `${slug}.guide.json`);
  if (!fs.existsSync(guidePath)) throw new Error(`No guide JSON for "${slug}" (${guidePath})`);
  const guide = JSON.parse(fs.readFileSync(guidePath, 'utf8'));
  let html = buildHtmlFromTemplate(guide, videoUrlFor(slug));
  html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">${MOBILE_HEAD}`);
  html = html.replace('</body>', `  <div class="download-bar"><a href="${WORKER}/pdf/${slug}">⬇️ Download the PDF</a></div>\n</body>`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${slug}.html`), html, 'utf8');
  if (withPdf) fs.copyFileSync(path.join(PDF_DIR, `${slug}.pdf`), path.join(OUT_DIR, `${slug}.pdf`));
  console.log(`✅ docs/guides/${slug}.html${withPdf ? ` + ${slug}.pdf` : ''}  →  ${WORKER}/guide/${slug}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const withPdf = args.includes('--with-pdf');
  const slugs = args.filter((a) => !a.startsWith('--'));
  if (!slugs.length) {
    console.log('Usage: node scripts/pdf/export-guide-page.js <slug> [<slug> ...] [--with-pdf]');
    process.exit(1);
  }
  for (const slug of slugs) exportPage(slug, withPdf);
}
