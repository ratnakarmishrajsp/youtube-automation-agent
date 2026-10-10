const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { runFFmpeg } = require('../../utils/ffmpeg');

const ROOT_DIR = path.resolve(__dirname, '../..');
const PDF_DIR = path.join(ROOT_DIR, 'data', 'pdfs');

/**
 * Extract all numbers/currencies/percentages matching the spec.
 * Regex: (₹|$)?\d[\d,.]*%? (plus optional multipliers like X, K, M)
 */
function extractNumbers(text) {
  if (!text) return [];
  const regex = /(?:[₹$])?\d+(?:[.,]\d+)*(?:%|[xXkKmMbB])?/g;
  const matches = text.match(regex) || [];
  return Array.from(new Set(matches.map(m => m.trim())));
}

/**
 * Hard guard (code): Every number in the guide JSON must appear in the transcript.
 * Also checks capitalised tool/brand names and warns if missing.
 */
function validateGuideNumbersAndBrands(guideData, transcriptText) {
  const guideString = JSON.stringify(guideData);
  const guideNumbers = extractNumbers(guideString);
  const transcriptNumbers = new Set(extractNumbers(transcriptText));

  // Also build normalized versions of numbers for flexible matching (e.g. 21X -> 21, ₹1499 -> 1499)
  const transcriptTokens = new Set(
    Array.from(transcriptNumbers).flatMap(num => [
      num.toLowerCase(),
      num.replace(/^[₹$]/, '').toLowerCase(),
      num.replace(/[xXkKmMbB%]$/, '').toLowerCase()
    ])
  );

  // Spoken number words in Hinglish and English transcripts
  const NUMBER_WORDS = {
    '1': ['one', 'ek'],
    '2': ['two', 'do'],
    '3': ['three', 'teen'],
    '4': ['four', 'chaar'],
    '5': ['five', 'paanch'],
    '6': ['six', 'chhe'],
    '7': ['seven', 'saat'],
    '8': ['eight', 'aath'],
    '9': ['nine', 'nau'],
    '10': ['ten', 'das'],
    '15': ['fifteen', 'pandrah'],
    '20': ['twenty', 'bees'],
    '21': ['twenty one', 'twenty-one', 'ikkees', '21x'],
    '30': ['thirty', 'tees'],
    '50': ['fifty', 'pachaas'],
    '75': ['seventy five', 'pachhattar'],
    '100': ['hundred', 'sau', 'ek sau'],
    '1000': ['thousand', 'hazaar']
  };

  const offendingNumbers = [];
  const lowerTranscript = transcriptText.toLowerCase();

  for (const num of guideNumbers) {
    const raw = num.toLowerCase();
    const stripped = raw.replace(/^[₹$]/, '').replace(/[xXkKmMbB%]$/, '');

    const existsDirect = lowerTranscript.includes(raw);
    const existsStripped = lowerTranscript.includes(stripped);
    const existsInTokens = transcriptTokens.has(raw) || transcriptTokens.has(stripped);

    const words = NUMBER_WORDS[stripped] || [];
    const existsInWords = words.some(w => new RegExp(`\\b${w}\\b`, 'i').test(lowerTranscript));

    if (!existsDirect && !existsStripped && !existsInTokens && !existsInWords) {
      offendingNumbers.push(num);
    }
  }

  if (offendingNumbers.length > 0) {
    throw new Error(
      `[HARD GUARD FAILED] Guide contains numbers not found in the video transcript: ${offendingNumbers.join(', ')}`
    );
  }

  // Capitalized brand/tool name check (warning only)
  const brandRegex = /\b[A-Z][a-zA-Z0-9]{2,}\b/g;
  const wordsInGuide = (guideString.match(brandRegex) || []).filter(
    w => !['The', 'And', 'For', 'With', 'From', 'This', 'That', 'Your', 'Step', 'Guide', 'Checklist', 'Takeaway'].includes(w)
  );
  const missingBrands = [];
  for (const word of wordsInGuide) {
    if (!transcriptText.toLowerCase().includes(word.toLowerCase())) {
      missingBrands.push(word);
    }
  }
  if (missingBrands.length > 0) {
    console.warn(`[BRAND GUARD WARNING] Tools/Brands not explicitly seen in transcript: ${Array.from(new Set(missingBrands)).join(', ')}`);
  }

  return true;
}

/**
 * Launch Chromium with Playwright, with fallbacks for Windows environments.
 */
async function launchBrowser() {
  const { chromium } = require('playwright');
  const launchOptions = { headless: true };

  // Try standard launch
  try {
    return await chromium.launch(launchOptions);
  } catch (err) {
    // Try system Chrome
    try {
      return await chromium.launch({ ...launchOptions, channel: 'chrome' });
    } catch (_chromeErr) {
      // Try system Edge
      return await chromium.launch({ ...launchOptions, channel: 'msedge' });
    }
  }
}

/**
 * Render HTML to A4 PDF using Playwright.
 */
async function renderPdf(htmlContent, outputPath) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '14mm',
        bottom: '16mm',
        left: '14mm',
        right: '14mm'
      }
    });
  } finally {
    await browser.close();
  }

  const stats = fs.statSync(outputPath);
  if (stats.size > 5 * 1024 * 1024) {
    throw new Error(`PDF size exceeds 5MB limit: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
  }
  return stats.size;
}

/**
 * Extract audio from video using FFmpeg.
 */
async function extractAudio(videoPath, audioPath) {
  console.log(`Extracting audio from ${videoPath} -> ${audioPath}...`);
  await runFFmpeg([
    '-y',
    '-i', videoPath,
    '-vn',
    '-acodec', 'libmp3lame',
    '-b:a', '128k',
    audioPath
  ]);
  if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
    throw new Error(`Failed to extract audio to ${audioPath}`);
  }
}

/**
 * Transcribe MP3 using Gemini 2.5 Flash via @google/genai.
 */
async function transcribeAudio(audioPath) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing from environment / .env');
  }

  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  console.log(`Transcribing audio with Gemini (gemini-2.5-flash)...`);
  const audioBuffer = fs.readFileSync(audioPath);
  const base64Audio = audioBuffer.toString('base64');

  const prompt = `Transcribe this audio verbatim in Latin-script Hinglish (English characters only, STRICTLY NO Devanagari script).
Capture every number, percentage, metric, brand name, and exact phrase spoken.
Preserve the exact words and flow.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      { inlineData: { mimeType: 'audio/mp3', data: base64Audio } },
      prompt
    ]
  });

  const transcript = response?.text?.trim();
  if (!transcript) {
    throw new Error('Gemini returned an empty transcript');
  }
  return transcript;
}

/**
 * Generate structured Guide JSON from transcript using Gemini.
 */
async function generateGuideJson(transcriptText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from .env');

  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const promptTemplatePath = path.join(__dirname, 'prompt.md');
  const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf8');

  console.log(`Generating factual guide JSON with Gemini...`);
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      `${promptTemplate}\n\n---\n## VERBATIM TRANSCRIPT TO PROCESS:\n${transcriptText}\n---\nRespond with JSON only.`,
    ],
    config: {
      responseMimeType: 'application/json'
    }
  });

  const rawText = response?.text?.trim();
  if (!rawText) throw new Error('Gemini returned empty guide JSON');

  let cleanJson = rawText;
  if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  return JSON.parse(cleanJson);
}

/**
 * Fill HTML template with guide data.
 */
function buildHtmlFromTemplate(guideData, youtubeUrl) {
  const templatePath = path.join(__dirname, 'template.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  html = html.replace(/{{TITLE}}/g, guideData.title || 'Official Guide');
  html = html.replace(/{{SUBTITLE}}/g, guideData.subtitle || '');
  html = html.replace(/{{BADGE}}/g, guideData.badge || '🔥 ACTIONABLE GUIDE');
  html = html.replace(/{{KEY_TAKEAWAY}}/g, guideData.keyTakeaway || '');
  html = html.replace(/{{YOUTUBE_URL}}/g, youtubeUrl || 'https://www.youtube.com/@ratnakarmishra06');

  const sectionsHtml = (guideData.sections || []).map(sec => `
    <div class="section-card">
      <div class="section-heading">${sec.heading}</div>
      <ul class="bullets-list">
        ${(sec.bullets || []).map(b => `<li>${b}</li>`).join('\n        ')}
      </ul>
    </div>
  `).join('\n');

  html = html.replace('{{SECTIONS_HTML}}', sectionsHtml);

  const checklistHtml = (guideData.checklist || []).map(item => `
    <div class="checklist-item">
      <div class="check-box">✓</div>
      <div>${item}</div>
    </div>
  `).join('\n');

  html = html.replace('{{CHECKLIST_HTML}}', checklistHtml);

  return html;
}

/**
 * Handle --approve flag: upload to KV if available or save approval state.
 */
async function handleApprove(slug, pdfPath, reviewPath) {
  if (!fs.existsSync(reviewPath)) {
    throw new Error(`Review file ${reviewPath} does not exist. Run without --approve first.`);
  }

  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  if (review.status !== 'PENDING_APPROVAL') {
    throw new Error(`Cannot approve: current status is "${review.status}"`);
  }

  console.log(`Approving PDF for slug "${slug}"...`);

  let uploadedToKv = false;
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = 'be7df7160222036acbc96121c6e89bd1';
  const kvNamespaceId = '290a436ac8ff4457af26a3dd1ba500a9';

  if (cfToken) {
    try {
      console.log(`Uploading to Cloudflare KV via API...`);
      const pdfBytes = fs.readFileSync(pdfPath);
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvNamespaceId}/values/pdf:${slug}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${cfToken}`,
          'Content-Type': 'application/pdf'
        },
        body: pdfBytes
      });
      const data = await res.json();
      if (data.success) {
        uploadedToKv = true;
        console.log(`✅ Uploaded to Cloudflare KV successfully!`);
      } else {
        console.warn(`KV API upload returned errors:`, data.errors);
      }
    } catch (apiErr) {
      console.warn(`KV API upload failed:`, apiErr.message);
    }
  }

  review.status = uploadedToKv ? 'APPROVED' : 'APPROVED_LOCAL';
  review.approvedAt = new Date().toISOString();
  review.url = `https://ratnakar-auto-dm.ratnakar-auto-dm.workers.dev/pdf/${slug}`;
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2), 'utf8');

  console.log(`✅ Status updated to: ${review.status}`);
  console.log(`🔗 Target URL: ${review.url}`);
}

/**
 * Main execution loop
 */
async function main() {
  const args = process.argv.slice(2);
  const isApprove = args.includes('--approve');
  const manifestArg = args.find(a => !a.startsWith('--'));

  if (!manifestArg) {
    console.error('Usage: node scripts/pdf/make-guide.js <manifestPath> [--approve]');
    process.exit(1);
  }

  const manifestPath = path.isAbsolute(manifestArg) ? manifestArg : path.join(process.cwd(), manifestArg);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Determine slug
  const slug = manifest.dm?.pdf?.slug ||
    path.basename(manifestPath, '.json').replace(/^\d{4}-\d{2}-\d{2}-/, '');

  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }

  const transcriptPath = path.join(PDF_DIR, `${slug}.transcript.txt`);
  const audioPath = path.join(PDF_DIR, `${slug}.audio.mp3`);
  const guideJsonPath = path.join(PDF_DIR, `${slug}.guide.json`);
  const pdfPath = path.join(PDF_DIR, `${slug}.pdf`);
  const reviewPath = path.join(PDF_DIR, `${slug}.review.json`);

  if (isApprove) {
    await handleApprove(slug, pdfPath, reviewPath);
    return;
  }

  // 1. Transcript: if exists, reuse; else extract and transcribe
  let transcriptText = '';
  if (fs.existsSync(transcriptPath)) {
    console.log(`Reusing existing transcript from ${transcriptPath}`);
    transcriptText = fs.readFileSync(transcriptPath, 'utf8').trim();
  } else {
    // Resolve video path
    let videoSource = manifest.dm?.pdf?.source || manifest.video;
    let absoluteVideoPath = path.isAbsolute(videoSource) ? videoSource : path.join(ROOT_DIR, videoSource);

    if (!fs.existsSync(absoluteVideoPath)) {
      throw new Error(`Video file not found at ${absoluteVideoPath}`);
    }

    await extractAudio(absoluteVideoPath, audioPath);
    transcriptText = await transcribeAudio(audioPath);
    fs.writeFileSync(transcriptPath, transcriptText, 'utf8');
    console.log(`Saved transcript to ${transcriptPath}`);
  }

  // 2. Guide JSON: generate using Gemini
  let guideData;
  if (fs.existsSync(guideJsonPath)) {
    console.log(`Reusing existing guide JSON from ${guideJsonPath}`);
    guideData = JSON.parse(fs.readFileSync(guideJsonPath, 'utf8'));
  } else {
    guideData = await generateGuideJson(transcriptText);
    fs.writeFileSync(guideJsonPath, JSON.stringify(guideData, null, 2), 'utf8');
    console.log(`Saved guide JSON to ${guideJsonPath}`);
  }

  // 3. Hard Guard (Code): number & brand validation
  console.log(`Running hard validation guards...`);
  validateGuideNumbersAndBrands(guideData, transcriptText);
  console.log(`✅ Hard validation passed! All numbers verified in transcript.`);

  // 4. Render HTML to PDF via Playwright
  console.log(`Rendering PDF via Playwright...`);
  const youtubeUrl = manifest.dm?.link || manifest.youtubeUrl || (manifest.youtube && manifest.youtube.url) || 'https://www.youtube.com/@ratnakarcontent';
  const htmlContent = buildHtmlFromTemplate(guideData, youtubeUrl);

  const pdfSize = await renderPdf(htmlContent, pdfPath);
  console.log(`✅ PDF generated successfully: ${pdfPath} (${(pdfSize / 1024).toFixed(1)} KB)`);

  // 5. Review JSON
  const reviewData = {
    status: 'PENDING_APPROVAL',
    slug,
    title: guideData.title,
    pdfPath,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(reviewPath, JSON.stringify(reviewData, null, 2), 'utf8');

  console.log('\n======================================================');
  console.log('📄 PDF READY FOR RATNAKAR TO REVIEW:');
  console.log(`👉 ${pdfPath}`);
  console.log('To approve, run:');
  console.log(`node scripts/pdf/make-guide.js "${manifestArg}" --approve`);
  console.log('======================================================\n');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error in make-guide:', err);
    process.exit(1);
  });
}

module.exports = {
  extractNumbers,
  validateGuideNumbersAndBrands,
  buildHtmlFromTemplate,
  renderPdf
};
