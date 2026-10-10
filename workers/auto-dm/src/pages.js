export function renderHtmlPage(title, heading, contentHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Ratnakar Mishra (@ratnakarcontent)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0A0F1D;
      color: #E2E8F0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 15px;
      line-height: 1.7;
      padding: 40px 20px;
    }
    .container {
      max-width: 720px;
      margin: 0 auto;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 36px 32px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    .brand-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .badge {
      background: #00FF66;
      color: #0A0F1D;
      font-family: 'Montserrat', sans-serif;
      font-weight: 900;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 6px;
      text-transform: uppercase;
    }
    .creator {
      font-family: 'Montserrat', sans-serif;
      font-weight: 700;
      font-size: 15px;
      color: #FFFFFF;
    }
    h1 {
      font-family: 'Montserrat', sans-serif;
      font-weight: 900;
      font-size: 26px;
      color: #FFFFFF;
      margin-bottom: 20px;
      line-height: 1.3;
    }
    h2 {
      font-family: 'Montserrat', sans-serif;
      font-weight: 800;
      font-size: 18px;
      color: #38BDF8;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    p { margin-bottom: 16px; color: #CBD5E1; }
    ul { margin-left: 20px; margin-bottom: 20px; }
    li { margin-bottom: 8px; color: #CBD5E1; }
    strong { color: #FFFFFF; }
    .contact-card {
      background: rgba(0, 255, 102, 0.08);
      border: 1px solid #00FF66;
      border-radius: 10px;
      padding: 16px 20px;
      margin-top: 28px;
      color: #F1F5F9;
    }
    .footer {
      margin-top: 32px;
      font-size: 12px;
      color: #64748B;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-header">
      <span class="badge">Official</span>
      <span class="creator">@ratnakarcontent · Ratnakar Mishra</span>
    </div>
    <h1>${heading}</h1>
    ${contentHtml}
    <div class="footer">
      © ${new Date().getFullYear()} Ratnakar Mishra. All rights reserved.
    </div>
  </div>
</body>
</html>`;
}

export function privacyPolicyHtml(contactEmail = 'contact@ratnakarmishra.com') {
  return renderHtmlPage(
    'Privacy Policy',
    'Privacy Policy for Instagram Automation',
    `
    <p>Last updated: October 10, 2026</p>
    <p>This privacy policy explains how <strong>@ratnakarcontent</strong> (managed by Ratnakar Mishra) collects, uses, and protects your information when you interact with our Instagram Reels and direct messages.</p>

    <h2>1. What Data We Collect</h2>
    <p>We process only the bare minimum data needed to fulfill requested resources:</p>
    <ul>
      <li><strong>Instagram Username & Scoped User ID (IGSID):</strong> To send you the requested direct message.</li>
      <li><strong>Comment Text & Interaction Timestamps:</strong> To detect keywords (such as "CLAUDE", "RTO") on our reels.</li>
      <li><strong>Direct Message Responses:</strong> Quick reply taps or text replies (such as "Followed ✅" or "DONE") to confirm delivery.</li>
    </ul>

    <h2>2. How We Use Your Data</h2>
    <ul>
      <li>To send you the specific tutorial link, PDF guide, or video resource that you requested by commenting.</li>
      <li>To verify that the guide or link is delivered only once per reel to avoid spamming your inbox.</li>
    </ul>

    <h2>3. Data Retention & Deletion</h2>
    <p>Interaction logs and deduplication identifiers are retained for a maximum of <strong>365 days</strong>, after which they are automatically purged.</p>
    <p>We do NOT sell, rent, or share your Instagram username, messages, or interaction data with any third parties or advertisers.</p>

    <div class="contact-card">
      <strong>Data Deletion Request:</strong> If you wish to have your interaction records or username deleted from our system at any time, simply send an email to <strong>${contactEmail}</strong> or send a DM to <strong>@ratnakarcontent</strong> on Instagram with the text "DELETE MY DATA". Your records will be deleted within 24 hours.
    </div>
    `
  );
}

export function termsOfServiceHtml(contactEmail = 'contact@ratnakarmishra.com') {
  return renderHtmlPage(
    'Terms of Service',
    'Terms of Service',
    `
    <p>Last updated: October 10, 2026</p>
    <p>By commenting on reels posted by <strong>@ratnakarcontent</strong> with specified keywords to receive automated resources, you agree to these Terms of Service.</p>

    <h2>1. Nature of the Service</h2>
    <p>This automated messaging system provides educational digital marketing resources, case study PDF guides, and video tutorial links directly to Instagram users who explicitly request them by commenting on our reels.</p>

    <h2>2. Educational Disclaimer</h2>
    <p>All materials, PDFs, case studies, and templates are provided strictly for educational and informational purposes based on the creator's personal business experience and publicly available information.</p>

    <h2>3. Fair Usage & Opt-out</h2>
    <p>Automated responses are triggered strictly on-demand. If you no longer wish to receive automated messages, simply do not comment on future keyword posts, or DM us on Instagram to be excluded.</p>

    <div class="contact-card">
      <strong>Contact:</strong> For questions regarding these terms, contact us at <strong>${contactEmail}</strong> or via Instagram DM at <strong>@ratnakarcontent</strong>.
    </div>
    `
  );
}

export function dataDeletionHtml(contactEmail = 'contact@ratnakarmishra.com') {
  return renderHtmlPage(
    'User Data Deletion Instructions',
    'User Data Deletion Instructions',
    `
    <p>In accordance with Meta Platform policies, users have the right to request the deletion of any data associated with their interactions with our Instagram application.</p>

    <h2>How to Request Data Deletion:</h2>
    <ol style="margin-left: 20px; margin-bottom: 20px;">
      <li style="margin-bottom: 10px;"><strong>Method 1 (Instagram DM):</strong> Send a direct message to <strong>@ratnakarcontent</strong> with the message <em>"DELETE MY DATA"</em>.</li>
      <li style="margin-bottom: 10px;"><strong>Method 2 (Email):</strong> Send an email to <strong>${contactEmail}</strong> with your Instagram username and the subject line <em>"Instagram Data Deletion Request"</em>.</li>
    </ol>

    <h2>What Happens Next:</h2>
    <p>Upon receiving your request:</p>
    <ul>
      <li>All associated comment logs, delivery logs, and pending check states corresponding to your account will be immediately deleted from our Cloudflare KV database within 24 hours.</li>
      <li>You will receive a confirmation message once your data has been completely purged.</li>
    </ul>
    `
  );
}
