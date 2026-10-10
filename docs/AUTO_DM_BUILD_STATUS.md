# Auto-DM build status

Spec: docs/AUTO_DM_FOLLOW_GATE_SPEC.md. Each phase appends a section here: done/blocked, what was built, commands, checklist results, open issues.

## Phase 0 — spec written (2026-10-10, Claude)
- Defaults: followGate "all", PDF approval ON.
- Status: Completed.

## Phase 1 — Worker Skeleton & Legal Pages — DONE (2026-10-10)
- **What was built & deployed:**
  - Cloudflare Worker deployed to live URL: `https://ratnakar-auto-dm.ratnakar-auto-dm.workers.dev`
  - Cloudflare KV Namespace `AUTO_DM` bound (ID: `290a436ac8ff4457af26a3dd1ba500a9`)
  - Live Legal & Utility Endpoints (200 OK verified):
    - Health Check: `https://ratnakar-auto-dm.ratnakar-auto-dm.workers.dev/health`
    - Privacy Policy: `https://ratnakar-auto-dm.ratnakar-auto-dm.workers.dev/privacy`
    - Terms of Service: `https://ratnakar-auto-dm.ratnakar-auto-dm.workers.dev/terms`
    - User Data Deletion: `https://ratnakar-auto-dm.ratnakar-auto-dm.workers.dev/data-deletion`
- **Meta App Dashboard Setup:**
  - App: `Ratnakar content` (ID: `1105670368507964`)
  - App Mode: Switched to **Live**
- **Checklist results:**
  - [x] All 4 URLs open over HTTPS with 200 OK
  - [x] `wrangler.toml` contains no secrets or credentials
  - [x] KV namespace created and attached to Worker

## Phase 2 — PDF guide generator — DONE (2026-10-10)
- **What was built:**
  - `scripts/pdf/prompt.md`: Factual Latin-script Hinglish directive for Gemini 2.5 Flash, strictly forbidding hallucinations.
  - `scripts/pdf/template.html`: Dark `#0A0F1D` A4 layout with Montserrat 900 headings, neon green `#00FF66`, yellow `#FFE600`, action checklist, and YouTube CTA card.
  - `scripts/pdf/make-guide.js`: End-to-end generator with FFmpeg MP3 extraction, Gemini verbatim transcription, hard number & brand guards, Playwright A4 render, and Cloudflare KV API upload on approval.
  - `test/pdf-number-guard.test.js`: Unit test asserting number equivalence and blocking fake/invented numbers (3/3 passed).
- **Approved & Uploaded Live PDFs (200 OK verified from Worker KV):**
  - `https://ratnakar-auto-dm.ratnakar-auto-dm.workers.dev/pdf/claude-startups` (607 KB)
  - `https://ratnakar-auto-dm.ratnakar-auto-dm.workers.dev/pdf/shiprocket-rto` (621 KB)
- **Checklist results:**
  - [x] Verbatim Latin-script Hinglish transcription without Devanagari
  - [x] Hard guard stops fake numbers in unit test and real runs
  - [x] Generated PDFs under 5 MB (~600 KB each)
  - [x] Approval flow uploads directly to Cloudflare KV
  - [x] PDF delivery endpoints tested and working live over HTTPS

## Phase 3 — Webhook logic in the Worker — DONE (2026-10-10)
- **What was built & deployed:**
  - `workers/auto-dm/src/flow.js`: Pure decision logic for comments and messages events (keyword matching, follow-gate branches, retries up to 3 times, resources message builder).
  - `workers/auto-dm/src/instagram.js`: Worker Graph API client (`sendPrivateReply`, `sendDirectMessage`, `postCommentReply`, `checkUserFollows`).
  - `workers/auto-dm/src/index.js`: Full routing with Webhook GET challenge, POST HMAC-SHA256 signature verification, `ctx.waitUntil()` async execution, GitHub Raw registry caching (5 min TTL), and `/stats` API.
  - `test/flow.test.js`: Comprehensive unit test suite (10/10 passed) covering keyword match/no-match, own comments, duplicate comments, already-delivered users, follow-check branches, max retries, and HMAC verification.
  - All 4 secrets synced to Worker (`IG_ACCESS_TOKEN`, `IG_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `STATS_KEY`).
  - Account subscription activated: `POST /me/subscribed_apps` returned `{ success: true }`.
- **Checklist results:**
  - [x] 10/10 unit tests passing
  - [x] HMAC-SHA256 signature validation active
  - [x] Deployed and live on Cloudflare
  - [x] Subscribed fields: `comments`, `messages`

## Phase 4 — Connect Meta — DONE (2026-10-10)
- Webhook Callback URL and Verify Token verified and saved in Meta Developer Dashboard.
- Subscribed fields: `comments` and `messages`.
- Account delivery enabled via `POST me/subscribed_apps`.

## Phase 5 — Pipeline Integration — DONE (2026-10-10)
- `scripts/publish-reel.js`:
  - Added support for `dm.followGate` ("all", "pdf", "none") and `dm.pdf` (`slug`, `title`).
  - Added approval guard: dry-run and execution fail if PDF is not approved yet with actionable hint.
  - Registry auto-syncs `followGate`, `pdfSlug`, and `pdfTitle`.
- `data/reels/_TEMPLATE.json`: Updated template manifest with `followGate` and `pdf` block.
- `scripts/status.js`: Added live Cloudflare Worker status integration via `/stats?key=<STATS_KEY>`. Tested and verified via `Check_Status.bat`.
- Old laptop task disabled: `schtasks /Change /TN Instagram_Auto_DM_Monitor /DISABLE` (Verified status: Disabled).
- Documentation updated: `AGENTS.md` and `GEMINI.md` updated with new architecture and commands.
- Acceptance criteria: 100% passed.

## Phase 6 — 60-Day Token Auto-Refresher — DONE (2026-10-10)
- `scripts/refresh-ig-token.js` created and executed.
- Refreshed token verified (valid for ~60 days).
- Automatically synced to `.env`, Cloudflare Worker secrets, and GitHub Actions secrets.
- Windows weekly scheduled task pending confirmation from Ratnakar.

## Phase 7 — Fix "messages nahi aa rahe" — DONE (2026-10-10, Claude)
- **Root causes found:**
  1. Meta sends `comments` webhooks only to apps with **Advanced Access** (App Review). Live mode alone is not enough, so the Worker never received a single real event (KV had only the `mock_ping`). `messages` webhooks did not arrive either.
  2. Reel 17/18 `followGate` + `pdfSlug` existed only in the local registry — never pushed to GitHub, which is what the Worker reads. (Demo worked because the registry had been PUT into KV without expiry by `scripts/cloud/sync-registry-kv.js`.)
  3. Test comment was "Calude" (typo).
  4. That test comment had already received a manual private reply at 16:18 — Instagram allows only one per comment, so the Worker's reply to it fails with "An unknown error has occurred". Not a code bug.
- **Fixes:**
  - `workers/auto-dm/src/poller.js` + cron `* * * * *`: polls new comments (via `me/media` comments_count + per-reel high-water mark) and DM replies (`me/conversations`) every minute; same handlers as the webhook (`src/handlers.js`). Works without Advanced Access.
  - Message-id dedupe (`m:` keys) so webhook + poller never double-process; replies older than the follow instructions are ignored.
  - Registry: GitHub first (5 min in-memory cache), KV only as fallback, rewritten only when content changes (saves KV writes).
  - Keyword typo tolerance for 5+ letter keywords (same length, one wrong/swapped letter).
  - Registry pushed with `publish-reel.js --sync`. Worker deployed (version 6170cfd3).
  - Tests: `node --test "test/*.test.js"` → 17/17 (3 new poller tests).
  - Weekly Windows task `Instagram_Token_Weekly_Refresh` (Sun 10:00) created.
- **Verified live:** cron ran, picked up the "Calude" comment, marked it, tried the private reply (failed only because of the one-reply limit).
- **Open:** real end-to-end test needs a NEW comment from @ratnakarmishra06. Replies come within ~1 min (not instant) until Meta grants Advanced Access — optional App Review later.
