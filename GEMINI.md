# Workspace Memory & Tools — YouTube Automation Agent

> 📖 **MASTER EDITORIAL BIBLE & ARCHITECTURE:** For complete end-to-end editorial blueprints, Hrishikesh Roy's HyperFrames deconstruction, color palettes, and cut patterns, see [MASTER_EDITORIAL_KNOWLEDGE_BASE.md](file:///c:/Users/Ratnakar/Desktop/Youtube/MASTER_EDITORIAL_KNOWLEDGE_BASE.md).

## 🗺️ Pipeline Map & Commands (updated 10 Oct 2026 — read this first)

**Editing ab yahan nahi hoti.** Reels/Shorts ka edit `C:\Users\Ratnakar\Desktop\Main Channel Video\` mein hota hai (har reel ka alag HyperFrames project: `reels/2_projects/<reel>/`, finals `reels/3_final/`). Wahan ka `START_HERE.md` + `AGENTS.md` follow karo. `tools/hyperframes` purana shared project hai.
Ye folder (`Youtube/`) = **publishing + automation hub**.

```
final mp4 → data/shorts/  →  manifest data/reels/<date>-<slug>.json  →  Publish_Reel.bat
   ├─ PDF Guide: node scripts/pdf/make-guide.js <manifest> (--approve to upload to Cloudflare KV)
   ├─ YouTube: private + publishAt (YouTube khud time pe publish karta hai)
   ├─ Instagram: CDN upload → container → data/instagram_reels_queue.json
   │     publish: GitHub Actions (exact time, waits up to 5h) + laptop task "Instagram_Reels_Auto_Queue" (backup, +2 min)
   └─ Cloudflare Worker (24/7 Auto-DM & Follow-Gate):
         Cron poll every minute (+ webhooks once Meta grants Advanced Access) → Private DM + Follow-Check → YouTube link + Approved PDF Guide
```

| Kaam | Command |
|---|---|
| PDF Guide generate / review karo | `node scripts/pdf/make-guide.js <manifest>` |
| PDF Guide approve karke KV upload karo | `node scripts/pdf/make-guide.js <manifest> --approve` |
| Nayi reel schedule karo | `data/reels/_TEMPLATE.json` copy karo → `Publish_Reel.bat` (ya `node scripts/publish-reel.js <manifest> --execute --push`) |
| Sab ka status (upcoming, failed, late, DM, publishers) | `Check_Status.bat` / `npm run status -- --live` |
| Instagram queue manually chalao | `node scripts/instagram-auto-scheduler.js` (`--dry-run`, `--force <id>`) |
| Weekly growth report | `npm run report:weekly` → `reports/growth/weekly-<date>.md` |

**Hard rules for agents:**
- **Naye per-reel scripts mat banao** (`schedule_reel_N_*.js` jaisa). Har reel = ek manifest JSON. `publish-reel.js` 5–7 tags, `#Reels`, "Comment X" CTA ke saath `dm` block, duplicate caption, aur past time — sab check karta hai.
- Caption mein "Comment X → DM" likha hai to manifest mein `dm: { keyword, link, followGate, pdf }` zaroori hai. PDF set hai toh approval ke bina publish nahi hoga.
- Shared code `scripts/lib/` mein hai (`instagram.js`, `youtube.js`, `dm-registry.js`). Graph API / CDN / YouTube upload code dobara copy-paste mat karo.
- Ye repo **PUBLIC** fork hai. `git add .` kabhi mat karo. Tokens sirf `.env` mein (`META_USER_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`), code mein kabhi nahi.
- Queue statuses: `READY_TO_PUBLISH` → `PROCESSING` → `PUBLISHED`; 3 fail = `FAILED`; container PUBLISHED par feed pe na mile = `NEEDS_REVIEW`.
- Auto-DM 24/7 Cloudflare Worker (`ratnakar-auto-dm`, code `workers/auto-dm/`) chalata hai. **Meta comment-webhooks sirf Advanced Access (App Review) ke baad bhejta hai**, isliye worker har minute comments + DM replies khud poll karta hai (`src/poller.js`); webhook bhi wired hai, KV keys (`c:`, `m:`) double-processing rokti hain. Laptop polling task disabled hai.
- Worker registry **GitHub se** padhta hai (`data/auto_dm_registry.json`), KV sirf fallback hai — registry change ke baad `node scripts/publish-reel.js --sync` (ya `--push`) zaroori hai. `scripts/cloud/sync-registry-kv.js` ki zaroorat nahi.
- **Nayi reels (registry mein `followGate` field) hamesha automated rehti hain** — koi 2 mahine baad bhi comment kare to DM jayega (Instagram rule: DM comment ke 7 din ke andar, reel ki age matter nahi karti). Purani reels (bina `followGate`) sirf pehle 7 din watch hoti hain.
- Instagram ek comment pe **sirf ek** private reply allow karta hai — test ke liye har baar naya comment karo, purane comment pe manual test DM mat bhejo.
- Worker deploy: `cd workers/auto-dm && npx wrangler deploy` (CLOUDFLARE_API_TOKEN `.env` se). Tests: `node --test "test/*.test.js"`.

## 🎓 Ratnakar's Core Editorial Standards & Training Manual (Strict Quality Mandates)
> **FOUNDATIONAL DIRECTIVE:** Hamesha **"Conscious Mind"** ka use karna hai. Mechanical checklist ya automated AI slop banakar nahi dena. Video ka har ek frame, sound aur caption international high-ticket creators (Iman Gadzhi, Alex Hormozi, Magnates Media, Ali Abdaal) level ka feel hona chahiye.

---

### 1. 🎧 Organic Sound Design (Strict "No Tang-Ting & No Random Whooshes" Rule)
- ❌ **Strictly Banned:**
  - Normal camera cuts ya facial zoom-in/zoom-out par baar-baar loud whoosh pelna bilkul mana hai.
  - Cheap "tang-ting" (arcade, video game, ya generic soundboard) sound effects strictly banned hain.
- ✅ **Master Standard:**
  - Sound effect tabhi aayega jab screen par koi **real tactile physical action** ho:
    - Natural mouse cursor clicks.
    - Tactile mechanical keyboard typing clicks.
    - Subtle paper slide / torn edge swoosh.
    - Real iOS chime / notification ping.
    - Deep sub-bass impact thud sirf genuine danger ya shock topic par (har cut par nahi).
  - Speaker ka voiceover hamesha crystal-clear, front, aur uncrowded hona chahiye.

---

### 2. 🎥 Context-Aware Smart B-Rolls & Graphic Preservation
- ❌ **Strictly Banned:**
  - Generic, disconnected ya vague stock videos (jaise office ke naam pe koi random door closing ya irrelevant clip) lagana mana hai.
  - **Cropping On-Screen Overlays/Graphics (Strict Violation):** Main raw video ke andar aane wale kisi bhi element, text overlay, graphic, speech bubble ya screenshot ko vertical crop mein kaat dena strictly prohibited hai!
- ✅ **Master Standard:**
  - B-roll transcript ke **exact context aur emotion** se match hona chahiye:
    - *"Office shutdown / corporate burnout"* ➔ Corporate office cubicle mein frustrated employee laptop pe kaam karta hua.
    - *"AI Agents / Autonomous workflows"* ➔ Clean 3D node connections / terminal code building.
    - *"Revenue / Stripe SaaS"* ➔ Real dashboard depth-of-field metrics.
  - **🎯 Mandatory Auto Zoom-Out for Video Elements & Overlays:**
    - Jab bhi main raw video mein koi graphic, illustration, customer chat bubble, screenshot ya on-screen text banner aaye:
      1. Foreground video ko turant smoothly **zoom-out karo (`scale: 1.0` ya `contain`)** taaki pura horizontal element 100% visible rahe aur left/right se ek millimeter bhi na kate.
      2. Background mein ambient blur layer depth provide karegi.
      3. Agar raw video ka graphic screen ke top/bottom tak fail raha ho, toh top header ya captions ko us duration ke liye subtle fade/reposition karo taaki koi overlap na ho.
      4. Jaise hi on-screen element khatam ho, camera wapas speaker par smoothly punch-in karega (`scale: 1.85x` with `ease: "power2.out"`).

---

### 3. ✂️ The Magnates Media AI Prompt + Paper-Cutout Formula
- Agar kisi niche ya specific topic ke liye authentic stock footage na mile, toh **irrelevant stock clip lagane ke bajaye ye formula execute karo:**
  1. Detailed prompt likh kar **cinematic AI image generate karo**.
  2. Subject ko **cutout / isolate** karo aur usme **vintage paper texture / torn edges** do.
  3. Image par **2.5D parallax camera push-in, subtle floating bob, aur dynamic highlighter/stamp effects** add karo.
  - Ye technique kisi bhi generic video se 10x zyada premium, artistic aur viral retention deti hai!

---

### 4. ✍️ Captions & Typography Mandates (English Latin Script & Anti-Clutter)
- ❌ **Strictly Banned:**
  - **Devanagari Hindi font strictly banned hai.** Subtitles/captions kabhi bhi Devanagari script mein nahi hone chahiye.
  - Constant wall-of-text: Har ek word transcribe karke screen ko robotic subtitles se bhar dena strictly banned hai.
  - Speaker ke face (`y: 280px` to `y: 1150px`) ke upar koi bhi box, card ya badge lagana strictly prohibited hai. Face 100% crystal-clear aur unobstructed hona chahiye!
- ✅ **Master Standard:**
  - **English / Latin Alphabet Only:** Saare captions English / Hinglish Latin characters mein honge (jaise *"PROBLEM CREATE KARTE HAIN DELIVERY BOYS!"*, *"1 MINUTE MANUAL CALL!"*).
  - **Selective High-Impact Punch Captions:** Poore reel mein sirf **6 se 8 key punchlines** aayengi jo high-expression moments par snappy pop-in hongi (`scale: 1` bounce) aur clean exit lengi (Hormozi / Iman Gadzhi style).
  - **Lower-Third Safe Placement:** Captions hamesha `bottom: 240px` to `260px` par rahenge taaki speaker ke haath, mic ya body ko disturb na karein.
  - **Typography & Aesthetics:** Bold **Montserrat 900** uppercase with `-webkit-text-stroke: 4.5px #000`, dark glassmorphism back-pill (`rgba(10, 15, 29, 0.88)`), aur vibrant neon accents:
    - Neon Green (`#00FF66`): Profit, Growth, RTO Drop, Success
    - Shock Yellow (`#FFE600`): Pricing, Numbers, Attention
    - Danger Red (`#FF3B30`): Scam, Warning, Delivery Boys Trap
    - Electric Cyan (`#38BDF8`): Calling, Script, Verification
  - **🏷️ Strict 5-7 Tags & #Reels Mandate:**
    - Kabhi bhi 15-20+ tags spam nahi karne hain. Tag bloat strictly banned hai.
    - Hamesha strictly **5 se 7 high-intent focused tags** dalo (aur `#Reels` zaroor include karo) taaki algorithm ka audience target pin-point rahe.


---

### 5. 🌊 Smooth Physics-Based Motion Graphics
- Linear ya stiff robotic keyframes strictly prohibited hain.
- Hamesha organic spring physics aur cubic-bezier easing use karo (`ease: "power3.out"`, `ease: "back.out(1.5)"`).
- UI badges aur tool cards (Claude 3.5 Sonnet, Cursor, OpenAI, n8n) mein subtle 3D perspective tilt (`rotateY`, `rotateX`), glassmorphism blur aur neon edge glow shamil ho.

---

### 6. ⚡ High-Speed 8-Worker Render Engine
- **Host Specs:** 13th Gen Intel Core i7-1355U (10 Cores, 12 Threads), Intel Iris Xe Graphics.
- **Render Engine:** HyperFrames (`tools/hyperframes`).
- **Render Command:**
  ```cmd
  cmd.exe /c "npx --yes hyperframes@0.8.85 render --workers 8 -o <output_filename.mp4>"
  ```
- 8 parallel Chromium capture workers utilization se 60s reel ka render time ~3.5 to 4 minutes mein complete hota hai.
- **Validation Command:** `cmd.exe /c "npm run check"` (0 errors required before final render).
- **Snapshot Inspection:** `cmd.exe /c "npx --yes hyperframes@0.8.85 snapshot --at <timestamps> --no-end -o snapshots_pro"`

---

## 🎨 Ratnakar's Signature Viral Edit Blueprint (Standard Template)
Har video mein ye core elements shamil rahenge:
1. **Top Viral Hook Header (`y: 130px` to `380px`):**
   - Creator Badge: `@ratnakarcontent` + Category Tag (`🔥 REALITY CHECK`, `🔥 FUTURE TECH`)
   - Headline Box 1: White Card `#FFFFFF` with Black Text (Uppercase Montserrat 900)
   - Headline Box 2: Neon Green Card `#00FF66` with Black Text (Uppercase Montserrat 900)
   - Punchline Sub-pill: Dark glassmorphic pill with subtitle summary
2. **CapCut-Style Retention Camera Punch-Ins:**
   - Vocal cuts aur key phrases par snappy punch-ins (`1.0x` ➔ `1.10x` ➔ `1.18x` ➔ `1.25x` on shock cuts with micro camera shake).
3. **Vox / Hormozi Picture-in-Picture (PiP) Mode:**
   - Speaker video smoothly scales into a bottom-corner glowing squircle while high-impact B-roll plays full screen, then snaps back.
4. **Architecture Standards (Zero Bloat):**
   - `compositions/header.html`
   - `compositions/badges.html`
   - `compositions/captions_part1.html` & `captions_part2.html`
   - `index.html` (mounts sub-compositions with `data-composition-id` and handles video zooms & audio tracks)

---

### 🧠 Auto-Context Visual Trigger Matrix (20 Advanced Production Archetypes)
Jab bhi script ya transcript mein ye keywords/topics aayenge, automatic ye elements integrate honge:

| # | Transcript Context / Keywords | HyperFrames Feature / Block | Visual Animation Effect |
| :--- | :--- | :--- | :--- |
| **1** | Website, Landing page, App demo, UI | `capture-tour` / `browser-device-stage` | Dynamic web preview, auto-scroll & cursor click pop |
| **2** | Coding, Terminal, Python, Script, Bash | `code-terminal-run` / `code-typing` | Glowing VS Code/terminal window typing syntax live |
| **3** | Mobile App, iOS, Android, Smartphone | `device-frame-stage` / `vfx-iphone-device` | 3D floating iPhone with live screen inside |
| **4** | Revenue, Money, Profit, Numbers, 100K, Crores | `apple-money-count` / `count-up` | Fast ticking number count-up with green particle glow |
| **5** | Market Growth, Analytics, Metrics | `bar-chart-race` / `data-chart` | Dynamic bar race or glowing upward line chart |
| **6** | Danger, Crash, Loss, Obsolete, Khatam | `decline-chart` / `camera-shake` | Red alert siren badge, downward crash curve & glitch |
| **7** | Before vs After, Manual vs AI, 0 vs 100 | `before-after-wipe` | Interactive sliding vertical wipe bar |
| **8** | Time, 5 Minutes, Fast, Seconds, Jaldi | `conic-progress-ring` / `stopwatch` | Animated circular countdown timer with buzzer beat |
| **9** | Tweet, X post, Viral quote | `x-post` / `x-follow-card` | Authentic Twitter card popping up with verified badge |
| **10** | Reddit post, Community thread | `reddit-post` | Reddit question card with upvote counter ticking |
| **11** | Chat, WhatsApp, DM, Client discussion | `chat-thread` / `message-thread-reveal` | Chat bubbles popping up one-by-one with text chime SFX |
| **12** | AI Workflow, Architecture, n8n, Pipeline | `flowchart-vertical` / `hw-pipeline` | Glowing node-to-node connecting wires and data packets |
| **13** | Breaking News, Big Announcement | `news-ticker` / `lower-third-bild` | TV style scrolling news ticker banner at the bottom |
| **14** | Tech Signal, Radar, AI Scanning, System | `lottie-signal` / `telemetry-hud` | Pulsing radar scan, neon tech grid & target brackets |
| **15** | Podcast, Voiceover, Audio note | `oscilloscope-trace` / `waveform` | Dynamic reacting audio waves dancing to frequencies |
| **16** | Glitch, Cyberpunk, AI takeover | `rgb-glitch-text` / `thermal-distortion` | Chromatic RGB split and camera distortion shake |
| **17** | Retention B-Roll, Split screen | `comparison-split` / `dual-stage` | Top speaker, bottom satisfying high-FPS visual stream |
| **18** | High energy music drop, Fast pacing | `beat-accent` / `whip-pan-cut` | Flash-through-white on kicks, whip pan camera transitions |
| **19** | Isolated Speaker / No background | `remove-background` | Background cutout placed on 3D neon studio/cyber grid |
| **20** | Outro / CTA, Comment, Follow | `cta-lockup` / `instagram-follow` | Animated Comment/Save/Follow card with glowing ring |

---

### 3. 🎬 Shared Legacy Tools
- **OpenMontage Video Production Studio:** `C:\Users\Ratnakar\Desktop\OpenMontage`
  - Remotion Composer & Stock Footage Scraper
- **Local Shorts Pipeline (OpenShorts):** `tools\openshorts`
