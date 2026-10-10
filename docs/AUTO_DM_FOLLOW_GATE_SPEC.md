# Auto-DM Follow-Gate + PDF Guides — Build Spec

Written by Claude on 2026-10-10 for Antigravity to build. Ratnakar reviews; Claude reviews only if something breaks.

---

## Ratnakar ke liye (2 minute padho)

**Antigravity ko ye prompt do:**

> `docs/AUTO_DM_FOLLOW_GATE_SPEC.md` poora padho, phir Phase 1 se shuru karo. Har phase ke end mein uski "Acceptance checklist" chalao aur `docs/AUTO_DM_BUILD_STATUS.md` update karo. Agla phase tabhi shuru karo jab pichhle ki checklist 100% pass ho. Jahan spec mein "ASK RATNAKAR" likha hai wahan ruk ke mujhse poocho.

**Aapko khud karna hai (Antigravity nahi kar sakta):**
1. Cloudflare free account banana (dash.cloudflare.com/sign-up) — Phase 1 se pehle.
2. `npx wrangler login` ke baad browser mein **Allow** dabana.
3. Meta App Dashboard mein URLs bharna + app ko Live karna (Phase 1 ke end mein Antigravity URLs dega).
4. Meta Dashboard mein webhook URL + verify token daalna (Phase 4 — values Antigravity dega).
5. Har PDF ko approve karna (agar approval ON rakha).

**Kuch toota to:** `docs/AUTO_DM_BUILD_STATUS.md` + error ka screenshot Claude ko dikhao.

**Decisions jo maine default rakhe hain (badalne ho to Antigravity ko bol dena):**
- Follow-gate: **ON** — link + PDF dono follow ke baad milenge (`followGate: "all"`).
- PDF approval: **ON** — har PDF aap dekh ke approve karoge, tabhi bheji jayegi.

---

## 0. Goal

When someone comments the reel's keyword (e.g. `CLAUDE`) on an Instagram reel:

```
1. Instant DM (private reply to the comment):
   "Hey @user 👋 <Title> ki PDF guide + full video unlock karne ke liye:
    1️⃣ @ratnakarcontent ko follow karo
    2️⃣ Phir neeche 'Followed ✅' dabao (ya reply mein DONE likho)"
   + public reply on the comment: "@user DM check karo 📩"
2. User taps "Followed ✅" (quick reply) or types DONE / followed / ho gaya
3. Check is_user_follow_business via Instagram User Profile API
   ├─ true  → send: YouTube link + PDF link   ("✅ Thanks for following! ...")
   └─ false → "Abhi follow nahi dikh raha 🙂 Follow karke dobara 'Followed ✅' dabao"  (max 3 times)
```

Every reel's PDF is generated from **that video's own transcript** and contains nothing that was not said in the video.

---

## 1. Verified Instagram API facts (do NOT deviate)

Checked against Meta docs on 2026-10-10. Host for this account: `https://graph.instagram.com/v20.0` (Instagram API with Instagram Login). The current token works with this host (see `scripts/lib/instagram.js`).

| Fact | Consequence for the build |
|---|---|
| Private reply = `POST /me/messages` with `{"recipient":{"comment_id":"<ID>"},"message":{...}}` | Use exactly this. Already implemented as `sendPrivateReply()` in `scripts/lib/instagram.js` — port the same request to the Worker. |
| **Only ONE private reply per comment**, and only **within 7 days** of the comment | Never retry after a success. If the API returns an error, nothing was sent, so one retry in a different shape is OK. Ignore comments older than 7 days. |
| Docs only document **text** in a private reply | Quick replies inside the private reply are **UNTESTED**. Try with `quick_replies`; if the API errors, resend **text only** that says "reply mein DONE likho". Log which variant worked. |
| Follow-up messages only after the user responds, and **within 24 h** of that response | Deliver/decline immediately when the user's message arrives. Never send unsolicited follow-ups. |
| `GET /<IGSID>?fields=username,is_user_follow_business` returns whether the user follows us | Only works **after the user has messaged us** (tap or text). It fails with a consent error on comment-only users — that is why step 2 exists. |
| Quick replies: max 13, title ≤ 20 chars, text only, **not shown on desktop** | One quick reply: title `Followed ✅`, payload `FOLLOWED`. Always also accept typed text (desktop users). |
| Webhook fields to subscribe: `comments`, `messages` | Comments arrive instantly — no more polling. |
| Webhook POSTs carry `X-Hub-Signature-256: sha256=<hmac>` of the raw body, keyed with the **Instagram app secret** | Verify every POST. Reject if invalid. |
| Webhook verification: `GET ?hub.mode=subscribe&hub.verify_token=X&hub.challenge=Y` → respond with `Y` | Implement on the same path. |
| Meta app is currently in **Development mode** → APIs/webhooks only return data for users with a role on the app (`@ratnakarmishra06` is one) | Build and test with `@ratnakarmishra06`. Real followers only work after Ratnakar switches the app to Live (and, if comments still don't show, App Review for `instagram_business_manage_comments` + `instagram_business_manage_messages`). |

**Payload shapes (log the raw payload first in Phase 3 and adjust if real events differ):**

```jsonc
// comments
{"object":"instagram","entry":[{"id":"<OUR_IG_ID>","time":1760000000,"changes":[{"field":"comments","value":{
  "from":{"id":"<IGSID>","username":"someone"},
  "media":{"id":"<MEDIA_ID>","media_product_type":"REELS"},
  "id":"<COMMENT_ID>","parent_id":"<only for replies>","text":"CLAUDE"}}]}]}

// messages (quick reply tap or typed text)
{"object":"instagram","entry":[{"id":"<OUR_IG_ID>","time":1760000000,"messaging":[{
  "sender":{"id":"<IGSID>"},"recipient":{"id":"<OUR_IG_ID>"},"timestamp":1760000000000,
  "message":{"mid":"...","text":"Followed ✅","quick_reply":{"payload":"FOLLOWED"}}}]}]}
// our own outgoing messages come back with "is_echo": true → ignore
```

---

## 2. Architecture

```
Instagram ──webhook──▶ Cloudflare Worker "ratnakar-auto-dm" (free plan, always on)
                         ├─ /webhook        GET verify, POST events (comments, messages)
                         ├─ /pdf/<slug>     serves approved PDFs from KV
                         ├─ /privacy /terms /data-deletion   static pages (needed for Meta Live mode)
                         ├─ /health         "ok"
                         └─ /stats?key=…    recent deliveries (for scripts/status.js)
                       reads config from GitHub raw:
                         data/auto_dm_registry.json (pushed by publish-reel.js --push and by the cloud scheduler)
                       stores state in KV namespace AUTO_DM (dedupe, pending follow checks, PDFs, logs)

Laptop (Node, existing repo):
  scripts/pdf/make-guide.js   video → transcript (Gemini) → guide JSON → branded PDF (Playwright) → approve → upload to KV
  scripts/publish-reel.js     gains dm.followGate + dm.pdf options
  scripts/status.js           shows Worker deliveries
```

**Why not the laptop:** button taps only arrive by webhook, which needs a public HTTPS URL that is up 24/7.

**After go-live the old laptop monitor must stop**, or every comment gets two replies:
`schtasks /Change /TN Instagram_Auto_DM_Monitor /DISABLE` (Phase 5).

---

## 3. Data model

### Registry entry (`data/auto_dm_registry.json`) — extend, keep old fields

```jsonc
{
  "queueId": 18,
  "mediaId": "18089381783672503",          // filled automatically on publish
  "title": "Claude Startups Program Rejected?",
  "keywords": ["claude", "link"],
  "youtubeUrl": "https://youtu.be/_CSYp1FTjY4",
  "followGate": "all",                     // NEW: "all" | "pdf" (link now, PDF after follow) | "none"
  "pdfSlug": "claude-startups",            // NEW: null if no PDF
  "pdfTitle": "Claude Startups Program — Apply Guide",   // NEW: shown in the DM
  "dmMessage": "...", "replyComment": "..."              // existing, used when followGate = "none"
}
```

Worker builds the PDF link as `https://<worker-host>/pdf/<pdfSlug>`. Entries without `pdfSlug` just send the YouTube link.

### Manifest (`data/reels/*.json`) — extend the `dm` block

```jsonc
"dm": {
  "keyword": "CLAUDE",
  "link": "https://youtu.be/_CSYp1FTjY4",
  "followGate": "all",
  "pdf": { "source": "data/shorts/claude_startups_reel_2.0.mp4", "slug": "claude-startups", "title": "Claude Startups Program — Apply Guide" }
}
```

`publish-reel.js` must: validate these fields, refuse `--execute` if `pdf` is set but the PDF is not approved+uploaded yet (message: "run make-guide first"), and copy `followGate/pdfSlug/pdfTitle` into the registry entry.

### KV keys (namespace `AUTO_DM`)

| Key | Value | TTL |
|---|---|---|
| `c:<commentId>` | `{"at":…, "variant":"quick_reply"|"text"}` — comment already handled | 30 days |
| `p:id:<IGSID>` and `p:u:<username>` | pending follow check `{mediaId, commentId, tries, at}` | 7 days |
| `d:<mediaId>:<username>` | delivered — never deliver twice for the same reel | 365 days |
| `pdf:<slug>` | PDF bytes (`put` with `metadata: {contentType:"application/pdf"}`) | none |
| `log:<ISO time>:<rand>` | `{type, user, mediaId, result, error}` | 30 days |
| `cfg:registry` | cached registry JSON | 5 min |

Free-plan limits: 1,000 KV writes/day. Each handled comment ≈ 4 writes → fine up to ~200 keyword comments/day. If that is ever exceeded, log a warning — do NOT switch to a paid plan without ASK RATNAKAR.

---

## 4. Phases

Work in order. After each phase: run its checklist, run `npx eslint <changed files>`, keep `npm test` green (in this repo the only expected local failure is "Engagement AI Provider Wiring", caused by GEMINI_API_KEY in .env — ignore that one), and append to `docs/AUTO_DM_BUILD_STATUS.md`:
`## Phase N — DONE/BLOCKED (date)` · what was built · commands run · checklist results · open issues.

### Phase 1 — Worker skeleton + legal pages (needs Ratnakar's Cloudflare login)

1. ASK RATNAKAR to create the Cloudflare account and run `npx wrangler login` himself (browser → Allow).
2. Create `workers/auto-dm/` with: `package.json` (devDependency `wrangler` pinned to an exact version), `wrangler.toml` (`name = "ratnakar-auto-dm"`, `main = "src/index.js"`, `compatibility_date` = today, KV binding `AUTO_DM`), `src/index.js` (router), `src/pages.js`.
3. Pages `/privacy`, `/terms`, `/data-deletion`: plain, honest, Hinglish/English. Say exactly what is processed: Instagram username, comment text and DM replies of people who comment a keyword, used only to send the requested link/PDF, kept max 365 days, deletion by emailing <CONTACT_EMAIL> or DMing @ratnakarcontent. ASK RATNAKAR which contact email to show. No legal claims beyond that.
4. `/health` → `ok`.
5. Add `workers/**` to the ignores in the root `eslint.config.js` (the Worker is ESM; give it its own lint config only if needed).
6. `npx wrangler kv namespace create AUTO_DM`, put the id in `wrangler.toml`, `npx wrangler deploy`.
7. Give Ratnakar these for Meta App Dashboard → App settings → Basic: Privacy Policy URL, Terms of Service URL, User data deletion URL; tell him to add a 1024×1024 icon, Category "Business and pages", Save, then switch App Mode to **Live**.

**Acceptance:** all four URLs open in a normal browser over HTTPS · `wrangler.toml` contains no secrets · status file updated.

### Phase 2 — PDF guide generator (local, no Instagram needed)

Files: `scripts/pdf/make-guide.js`, `scripts/pdf/template.html`, `scripts/pdf/prompt.md`, output in `data/pdfs/`.

```
node scripts/pdf/make-guide.js data/reels/<manifest>.json           # build PDF for review
node scripts/pdf/make-guide.js data/reels/<manifest>.json --approve # upload to Worker KV + mark approved
```

1. **Transcript:** if `data/pdfs/<slug>.transcript.txt` exists, reuse it. Else extract audio with `utils/ffmpeg.js` (`getFFmpegPath()`; ffmpeg is not on PATH) → mp3 → transcribe with Gemini (`@google/genai`, key `GEMINI_API_KEY` from `.env`, model `gemini-2.5-flash`). Ask for a verbatim transcript in **Latin-script Hinglish** (Devanagari is banned in this workspace). Save the `.transcript.txt`.
2. **Guide JSON:** send transcript + `prompt.md` to Gemini; require JSON: `{title, subtitle, sections:[{heading, bullets:[…]}], checklist:[…], keyTakeaway}`. 2–4 pages worth. Rules inside `prompt.md`:
   - Use ONLY facts, numbers, tool names and steps that appear in the transcript. Nothing invented. If the transcript is thin, make the guide shorter — never pad.
   - Opinions about companies stay labelled as the creator's experience.
   - Latin-script Hinglish/English only.
3. **Hard guard (code, not prompt):** every number in the guide JSON (regex `\d[\d,.]*%?`, also `₹…`, `$…`) must appear in the transcript; otherwise fail with the list of offending numbers. Same check for capitalised tool/brand names against a list extracted from the transcript — warn only.
4. **Render:** fill `template.html` (A4, Montserrat 900 headings via Google Fonts, dark `#0A0F1D` cover, accents neon green `#00FF66` / yellow `#FFE600` / cyan `#38BDF8` from AGENTS.md, footer "@ratnakarcontent · YouTube: Ratnakar Mishra Digital Marketing", last block "📺 Full video: <youtube link>"). Render with Playwright (already installed, v1.54) `page.pdf({format:'A4', printBackground:true})`. Keep PDF < 5 MB.
5. **Review:** write `data/pdfs/<slug>.pdf`, `<slug>.guide.json`, `<slug>.review.json` = `{"status":"PENDING_APPROVAL"}`; print the path and tell Ratnakar to open it.
6. **`--approve`:** only if `status` is PENDING_APPROVAL → `npx wrangler kv key put --binding AUTO_DM pdf:<slug> --path data/pdfs/<slug>.pdf --metadata '{"contentType":"application/pdf"}' --remote` (check current wrangler syntax with `--help`), set `status: APPROVED, url: https://<worker>/pdf/<slug>`.
7. Worker route `/pdf/<slug>`: read KV, return with `Content-Type: application/pdf`, `Content-Disposition: inline; filename="<slug>.pdf"`. 404 if missing.

**Acceptance:** generate for Reel 18 (`data/reels/2026-10-10-claude-startups.json`, video `data/shorts/claude_startups_reel_2.0.mp4`) and for the Shiprocket reel (find its final mp4 in `data/shorts/` or ASK RATNAKAR) · number guard catches a deliberately inserted fake number in a unit test · Ratnakar approves at least one · its `/pdf/<slug>` URL opens on a phone.

### Phase 3 — Webhook logic in the Worker

Files: `src/instagram.js` (graph calls), `src/flow.js` (pure decision logic, no I/O), `src/index.js` (wiring), `test/flow.test.js` (`node --test`, fetch mocked).

Secrets (never in files, never printed): `IG_ACCESS_TOKEN`, `IG_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `STATS_KEY`. Set them with `npx wrangler secret put <NAME>`. For `IG_ACCESS_TOKEN`, pipe the value from `.env` via a tiny Node helper so it never appears in the terminal or logs. `IG_APP_SECRET` = the **Instagram app secret** (Meta Dashboard → Instagram → API setup with Instagram business login) — ASK RATNAKAR to paste it into `.env` as `INSTAGRAM_APP_SECRET` himself. `WEBHOOK_VERIFY_TOKEN` and `STATS_KEY`: generate random strings, store in `.env`.

Logic:
1. `GET /webhook` verification.
2. `POST /webhook`: verify signature on the raw body → respond `200 EVENT_RECEIVED` immediately → process in `ctx.waitUntil()`.
3. **First deploy of this phase: only log raw payloads to KV** (`log:` keys). Comment "TEST" from `@ratnakarmishra06` once Phase 4 subscriptions exist, inspect, then enable actions.
4. **comments event:**
   - ignore if `from.username` is `ratnakarcontent`, if `parent_id` belongs to our own reply, if `c:<commentId>` exists, if media not in registry, if keyword doesn't match (same rule as `matchesKeyword()` in `scripts/growth/auto-dm-monitor.js`: keyword at a word start, case-insensitive).
   - if `d:<mediaId>:<username>` exists → already delivered; just mark `c:` and stop.
   - `followGate = "none"` → private reply with the resources; public reply.
   - otherwise → private reply with the follow instructions + quick reply `Followed ✅`/`FOLLOWED`; on API error retry once **text-only** ("reply mein DONE likho"); store `p:id:` and `p:u:`; public reply `@user DM check karo 📩`.
   - `followGate = "pdf"` → the first private reply already contains the YouTube link; only the PDF is gated.
   - always write `c:<commentId>` and a `log:` entry, success or failure.
5. **messages event** (ignore `is_echo`):
   - accept if `quick_reply.payload === "FOLLOWED"` OR text matches `/^\s*(done|followed|follow (kar )?diya|ho gaya|followed ✅)\s*$/i`. Otherwise do nothing (do not hijack normal DMs).
   - find pending by `p:id:<sender.id>`; if missing, call the profile API for `username` and try `p:u:<username>`; if still missing → do nothing.
   - profile API `is_user_follow_business`:
     - true → send the resources, write `d:` key, delete the pending keys.
     - false → reply "Abhi follow nahi dikh raha 🙂 …" with the quick reply again; `tries+1`; after 3 tries stop replying (delete pending).
     - error → log it, send nothing.
6. **Messages (Hinglish, short, no spammy caps):** resources message =
   `✅ Thanks for following!\n\n📄 <pdfTitle>: <pdf url>\n📺 Full video: <youtubeUrl>\n\nKoi sawaal ho to yahin reply karo 🙂`
7. Registry: fetch `https://raw.githubusercontent.com/ratnakarmishrajsp/youtube-automation-agent/master/data/auto_dm_registry.json`, cache 5 min in `cfg:registry`; if fetch fails use the cached copy.
8. `/stats?key=<STATS_KEY>` → last 50 `log:` entries as JSON.

**Acceptance (unit tests, all with mocked fetch):** keyword match/no-match · own comment ignored · duplicate comment ignored · already-delivered user skipped · quick-reply failure falls back to text-only with exactly one more request · follow=true delivers once · follow=false asks again and stops after 3 · unrelated DM ignored · bad signature → 401 and no processing.

### Phase 4 — Connect Meta (Ratnakar + Antigravity)

1. ASK RATNAKAR to open Meta Dashboard → Instagram → API setup with Instagram business login → **Configure webhooks**: Callback URL `https://<worker-host>/webhook`, Verify token = `WEBHOOK_VERIFY_TOKEN` (Antigravity shows it to him once, in chat — not in a file that gets committed). Subscribe fields **comments** and **messages**.
2. Enable delivery for the account: `POST https://graph.instagram.com/v20.0/me/subscribed_apps?subscribed_fields=comments,messages` with the token (confirm the exact call in Meta docs if it errors).
3. Test with `@ratnakarmishra06` on Reel 18 (`CLAUDE`): (a) comment while **not** following → DM + public reply; tap Followed → "abhi follow nahi dikh raha"; (b) follow, tap again → link + PDF; (c) comment again → nothing new; (d) desktop: type `DONE` instead of tapping.

**Acceptance:** all four test cases behave as written; `/stats` shows them; no duplicate messages.

### Phase 5 — Integrate with the pipeline

1. `publish-reel.js`: new `dm.followGate` / `dm.pdf` fields (see §3), validation, registry copy, and the "PDF not approved yet" guard. Update `data/reels/_TEMPLATE.json`.
2. `scripts/status.js` AUTO-DM section: call `/stats` (URL + key from `.env`: `AUTO_DM_WORKER_URL`, `AUTO_DM_STATS_KEY`) and show last deliveries + failures. Keep working if the Worker is unreachable.
3. Disable the old laptop monitor: `schtasks /Change /TN Instagram_Auto_DM_Monitor /DISABLE`. Keep the script file (fallback).
4. Update `AGENTS.md` and `GEMINI.md` (identical copies) "Pipeline Map & Commands" with the new flow and commands.

**Acceptance:** dry-run of `publish-reel.js` on a manifest with `pdf` but no approval fails with the right message · `Check_Status.bat` shows Worker data · task disabled (`schtasks /Query /TN Instagram_Auto_DM_Monitor`).

### Phase 6 — Token never expires silently

Instagram long-lived tokens last ~60 days. One weekly refresher on the laptop:
`scripts/refresh-ig-token.js` → `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<token>` → write the new token to `.env` (`INSTAGRAM_ACCESS_TOKEN`), to the GitHub secret (`gh secret set INSTAGRAM_ACCESS_TOKEN --repo ratnakarmishrajsp/youtube-automation-agent`, value via stdin), and to the Worker (`wrangler secret put IG_ACCESS_TOKEN`, via stdin). Never print the token. Log `expires_in` days. ASK RATNAKAR before creating the weekly Windows task.

**Acceptance:** one manual run succeeds; status file records the new expiry date (not the token).

---

## 5. Rules — breaking these is how things went wrong before

- This repo is a **PUBLIC** GitHub fork. Never `git add .` / `git add -A`. Add files by name. Never commit `.env`, tokens, app secret, verify token, `data/instagram_browser_profile/`, PDFs not yet approved.
- Never print a token or secret in the terminal, logs, KV, status file or chat.
- Reuse `scripts/lib/instagram.js` (and keep its behaviour) — don't copy-paste Graph API code into new scripts. The Worker is the only place that gets its own small copy (it can't `require` Node code).
- Don't touch `scripts/instagram-auto-scheduler.js`, `.github/workflows/*`, or `scripts/lib/queue-sync.js` — the publishing side works and is verified. If you think they need a change, ASK RATNAKAR (he will ask Claude).
- Don't send a single test DM to anyone except `@ratnakarmishra06`.
- No new paid services, no new accounts created by you.
- PDFs: nothing invented — the number guard must stay on.
- Captions/text: Latin-script Hinglish only (no Devanagari).
- Every phase ends with the status file updated, so another agent can continue.

## 6. Done means

A real follower comments the keyword on a new reel published with `Publish_Reel.bat`, gets the follow instructions within seconds, taps Followed, and receives the approved PDF + YouTube link — with nobody touching the laptop.
