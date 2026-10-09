# 🎬 MASTER EDITORIAL KNOWLEDGE BASE & PRODUCTION BIBLE
### The Ultimate Video Creation & Motion Design Standard for Ratnakar (@ratnakarcontent)
> **Target Audience for this Document:** AI Agents (Claude Opus 5.5, Gemini Pro/Flash, GPT-5), Video Editors, Motion Designers, and Automated Production Pipelines in Google Antigravity.
> 
> **Core Directive:** "Conscious Mind Only". No robotic AI slop. Every frame, transition, sound effect, and typographic layout must match the production quality of international high-ticket creators (**Iman Gadzhi, Alex Hormozi, Magnates Media, Ali Abdaal**) and top-tier tech explainers (**Hrishikesh Roy**).

---

## 📑 TABLE OF CONTENTS
1. [Core Creator Persona & Video Relatability](#1-core-creator-persona--video-relatability)
2. [The Hrishikesh Roy Signature Style Deconstruction](#2-the-hrishikesh-roy-signature-style-deconstruction)
3. [HyperFrames Code-to-Video Architecture](#3-hyperframes-code-to-video-architecture)
4. [Strict Non-Negotiable Editorial Rules (Ratnakar's Quality Mandates)](#4-strict-non-negotiable-editorial-rules)
5. [Cut & Retention Patterns (Long-Form vs Reels/Shorts)](#5-cut--retention-patterns)
6. [Design System & Visual Language (Neo-Brutalism + Cyber-Tech)](#6-design-system--visual-language)
7. [Organic Sound Design Architecture](#7-organic-sound-design-architecture)
8. [The 20 Auto-Context Visual Trigger Archetypes](#8-the-20-auto-context-visual-trigger-archetypes)
9. [Pre-Flight Validation & 8-Worker Render Pipeline](#9-pre-flight-validation--8-worker-render-pipeline)

---

## 1. CORE CREATOR PERSONA & VIDEO RELATABILITY

### 🎯 Who is Ratnakar?
- **Niche:** AI Automation, Agentic Workflows, No-Code/Low-Code Dev, E-commerce Growth (Shopify/COD/RTO fixes), Business Tech, and Future Tech Reality Checks.
- **Tone:** Direct, authoritative, no-BS, authentic Indian practitioner voice. Talks from real testing, real metrics, and real rupees (₹), not generic theoretical advice.
- **Relatability Factor:** 
  - Speaks to founders, agencies, freelancers, developers, and tech creators in India who are tired of superficial AI hype.
  - Relatable context: *"Kirana store Udhaar Khata", "GST bill India-only bugs", "Delivery boy RTO scam", "Stripe SaaS vs Indian Payment Gateways"*.
  - Language: Crisp Hinglish (Latin alphabet only) with punchy, conversational phrasing.

---

## 2. THE HRISHIKESH ROY SIGNATURE STYLE DECONSTRUCTION

Hrishikesh Roy's videos (*"5 GitHub Repos for Digital Marketing"*, *"Claude Sonnet 5.5 itna Sasta?"*) have set the benchmark for modern code-driven tech videos in India.

### 📐 Structural Pillars of Hrishikesh Roy's Editing:
1. **Audio-as-Master-Clock:**
   - Every cut, card, and animation is locked to the voiceover timestamps (`tStartMs` from ElevenLabs / Whisper). Visuals never wander aimlessly; they are born and die on exact word hits.
2. **Neo-Brutalist Editorial Stage:**
   - **Background:** Warm cream paper texture (`#ECE8DE`) with subtle dot-matrix grid (`#C5BFB0` 2px dots, 32px spacing).
   - **Cards:** Clean stark white `#FFFFFF` cards with 3px–4px solid obsidian borders (`#1E293B`) and hard-offset 90° drop shadows (`box-shadow: 14px 14px 0px #000000`).
   - **Handwritten Human Touch:** Green/Cyan cursive callouts using `Caveat` or `Nanum Pen Script` at `-3deg` to `-6deg` tilt (`"Must Try!"`, `"Save 80% Cost"`, `"Bug Found Here"`).
3. **Pacing Formula (Per Section/Chapter):**
   - **0.0s – 3.0s (Shock Hook):** Full-screen punchy title block, high-contrast stamp (`"NEW AI TOOL!"`), subtle deep sub-bass impact.
   - **3.0s – 15.0s (The Big Picture / Split Stage):** Left side holds an animated node flowchart (input ➔ AI agent ➔ output), right side holds speaker video framed inside a rounded card with a 14px hard shadow.
   - **15.0s – 35.0s (Live Screen / Terminal Proof):** Smooth zoom into the actual app, GitHub repo, or terminal with glowing syntax highlighting and cursor clicks.
   - **35.0s – 45.0s (Striped Fast-Paced Transition):** High-energy diagonal zebra stripes or whip-pan cut into the next chapter.

---

## 3. HYPERFRAMES CODE-TO-VIDEO ARCHITECTURE

Both Hrishikesh Roy and Ratnakar's master pipeline run on **HyperFrames (`heygen-com/hyperframes`)**, an HTML/CSS/JS headless rendering engine.

### 🛠️ File Structure Convention:
```
tools/hyperframes/
├── hyperframes.json                 # Project configuration, resolution, FPS
├── index.html                       # Master timeline mounting sub-compositions
├── assets/                          # Voiceover MP3, BGM, SFX, logos, fonts
│   ├── voiceover.mp3
│   ├── bgm_ambient_tech.mp3
│   └── sfx/ (pop.mp3, typing.mp3, chime.mp3)
└── compositions/                    # Modular scenes (0 bloat)
    ├── header.html                  # Top hook bar & category badge
    ├── badges.html                  # Tool badges (Claude, Cursor, n8n, etc.)
    ├── captions_part1.html          # Dynamic punch captions
    ├── intro_hrishikesh.html        # Shock hook & split canvas
    └── outro_hrishikesh.html        # YouTube spotlight & CTA
```

### 💻 Master Timeline Sample (`index.html`):
```html
<div id="video-root" data-fps="30" data-width="1920" data-height="1080">
  <!-- Master Audio Clock -->
  <audio class="clip" src="assets/voiceover.mp3" data-start="0.0" data-volume="1.0"></audio>
  <audio class="clip" src="assets/bgm.mp3" data-start="0.0" data-volume="0.12" data-duck-with="voiceover"></audio>

  <!-- Scene 1: Shock Title -->
  <div class="clip" data-start="0.0" data-duration="3.5" data-composition-id="intro_hook" data-composition-src="compositions/intro_hrishikesh.html"></div>

  <!-- Scene 2: Split Canvas Flowchart -->
  <div class="clip" data-start="3.5" data-duration="12.0" data-composition-id="split_node_flow" data-composition-src="compositions/intro_hrishikesh.html"></div>

  <!-- Scene 3: Live Terminal & Proof -->
  <div class="clip" data-start="15.5" data-duration="20.0" data-composition-id="terminal_scene"></div>
</div>
```

---

## 4. STRICT NON-NEGOTIABLE EDITORIAL RULES

These rules must NEVER be violated by any AI model or human editor:

### 🎧 Rule 1: Organic Sound Design (Strict "No Tang-Ting & No Random Whooshes")
- ❌ **Strictly Banned:**
  - Fast whooshes on normal camera cuts or simple zoom-ins.
  - Arcade, cartoon, video-game "tang-ting" or toy sound effects.
  - Overcrowded soundbeds where sound effects clash with the voice.
- ✅ **Mandatory Standard:**
  - SFX only triggers on **tactile, physical on-screen actions**:
    - Mouse cursor clicking a button ➔ Subtle mechanical click.
    - Code being typed ➔ Real tactile keyboard clicks (`typing.mp3`).
    - Paper or card sliding in ➔ Subtle paper swoosh.
    - Notification / alert badge ➔ Real iOS system chime.
    - Sub-bass impact thud (`impact-bass-1.mp3`) ➔ Reserved strictly for shock moments, warnings, or chapter title cards.

### 🎥 Rule 2: Graphic Preservation & Context-Aware Smart B-Rolls
- ❌ **Strictly Banned:**
  - **Cropping on-screen graphics (The #1 Crime):** If the raw video or screen recording contains an interface, chat bubble, dashboard metric, or diagram, vertical 9:16 cropping that chops the left/right edges is STRICTLY FORBIDDEN!
  - Generic, irrelevant stock footage (e.g., random office workers smiling when discussing API rate limits).
- ✅ **Mandatory Auto Zoom-Out for Overlays:**
  - Whenever an on-screen element, UI screenshot, or graphic appears in the raw footage:
    1. The main video must smoothly zoom-out (`scale: 1.0` or `contain`) so 100% of the graphic is visible.
    2. Background fills with a 24px ambient blur of the same footage.
    3. Any conflicting top banners or captions fade out temporarily.
    4. Once the graphic finishes, smoothly punch back into the speaker (`scale: 1.85x` with `ease: "power2.out"`).

### ✍️ Rule 3: Captions & Typography Mandates
- ❌ **Strictly Banned:**
  - **Devanagari Hindi font is strictly banned.** Subtitles must NEVER be in Devanagari script.
  - Continuous wall-of-text: Robotic transcription of every single syllable cluttering the screen is banned.
  - Obstructing the speaker's face (`y: 280px` to `y: 1150px` in vertical 1080x1920) with cards or badges.
- ✅ **Mandatory Standard:**
  - **English / Latin Alphabet Only:** Hinglish / English uppercase (e.g., *"1 MINUTE MANUAL CALL!"*, *"DELIVERY BOY TRAP"*).
  - **Selective High-Impact Punch Captions:** Only 6 to 8 key punchlines per 60-second video. Pop-in on vocal peak, hold for 1.2s, clean snap out.
  - **Placement:** Lower-third safe zone (`bottom: 240px` to `260px`).
  - **Font & Style:** Montserrat 900 uppercase, `-webkit-text-stroke: 4.5px #000`, dark glassmorphic back-pill (`rgba(10, 15, 29, 0.88)`), accented with:
    - Neon Green (`#00FF66`): Profit, Revenue, RTO Drop, Success.
    - Shock Yellow (`#FFE600`): Pricing, Numbers, Attention.
    - Danger Red (`#FF3B30`): Traps, Warnings, Bugs, Scams.
    - Electric Cyan (`#38BDF8`): AI, Automations, Workflows.

### 🏷️ Rule 4: Strictly 5-7 High-Intent Tags
- Never spam 15–20 tags.
- Always include strictly 5 to 7 targeted tags with `#Reels` included.

---

## 5. CUT & RETENTION PATTERNS

### 🎞️ Pattern A: Vertical Shorts / Reels (60s Blueprint)
1. **0.0s – 2.0s (Top Hook Header & Vocal Punch):**
   - Top Header displays: `@ratnakarcontent` + Category Tag (`🔥 REALITY CHECK`, `🔥 AI WORKFLOW`).
   - Headline 1 (White Card) + Headline 2 (Neon Green Card).
   - Speaker camera at `1.0x` punching to `1.15x` on the first punchline.
2. **2.0s – 15.0s (Problem Agitation):**
   - Rapid cuts every 2.5–3.2 seconds.
   - Alternating punch-ins (`1.0x` ➔ `1.12x` ➔ `1.20x` with subtle 2px camera shake on hard vocal consonants).
3. **15.0s – 40.0s (Solution / Proof / Vox PiP Mode):**
   - Speaker video shrinks smoothly into a bottom-right rounded squircle with neon glow (`scale: 0.32`, `borderRadius: 28px`).
   - High-impact visual (code terminal, n8n workflow, or live dashboard) plays full-screen.
4. **40.0s – 55.0s (The Secret / High-Ticket Insight):**
   - Camera snaps back to speaker close-up (`1.25x`), delivering the core takeaway.
5. **55.0s – 60.0s (CTA Lockup):**
   - Comment keyword trigger badge (e.g., *"Comment 'AGENT' for Workflow"*).

### 🖥️ Pattern B: Horizontal Long-Form YouTube (10m–16m Blueprint)
1. **Chapter Structure:**
   - 0:00 – 1:30 Hook + The Grand Promise + Proof of Results.
   - 1:30 – 4:00 The Paradigm Shift / Mental Model (Neo-brutalist node flowcharts).
   - 4:00 – 12:00 Hands-on Implementation (Step-by-step with terminal/browser device frames).
   - 12:00 – 14:30 Common Traps, Cost Analysis (Rupees ₹), & Safety Guardrails.
   - 14:30 – End Summary + High-Value Resource Link + Outro Spotlight Card.
2. **Camera Reframing:**
   - Wide shot on contextual transitions; punch-in crop (115%–120%) whenever an emotional or warning sentence is spoken.

---

## 6. DESIGN SYSTEM & VISUAL LANGUAGE

### 🎨 Color Palette Tokens
| Token Name | Hex Code | Purpose |
| :--- | :--- | :--- |
| **Paper Canvas** | `#ECE8DE` | Hrishikesh-style editorial background |
| **Grid Dot** | `#C5BFB0` | 2px dot-matrix pattern (32px pitch) |
| **Obsidian Dark** | `#0F172A` | Primary card border, dark mode background |
| **Card White** | `#FFFFFF` | Stark white card body |
| **Neon Green** | `#00FF66` | Success, ROI, Profit, High-conversion pills |
| **Shock Yellow** | `#FBBF24` / `#FFE600` | Attention grabbers, headline highlights |
| **Danger Coral** | `#EF4444` / `#FF3B30` | Red flags, traps, warning stamps |
| **Electric Cyan** | `#38BDF8` | Nodes, connectors, AI tech accents |

### 🖋️ Typography Rules
- **Headline Font:** `Montserrat` (Weight 900 Black), `letter-spacing: 2px - 4px`, uppercase.
- **Body & Code Font:** `Inter` / `JetBrains Mono` for terminal and UI elements.
- **Handwritten Accent Font:** `Caveat` (Weight 700) or `Nanum Pen Script` at `-4deg` tilt for human annotations.

### 📐 Motion Physics (GSAP Standards)
- **NO LINEAR MOTION:** Every animation must use organic spring physics:
  - Card Pop-in: `ease: "back.out(1.6)"`, duration: `0.45s`.
  - Camera Punch: `ease: "power3.out"`, duration: `0.35s`.
  - Card Slide-out: `ease: "power2.in"`, duration: `0.28s`.
  - Floating Bob: `y: "+=8px"`, `yoyo: true`, `repeat: -1`, `ease: "sine.inOut"`, duration: `2.4s`.

---

## 7. ORGANIC SOUND DESIGN ARCHITECTURE

| Action on Screen | Allowed Sound Effect | File Path / Reference |
| :--- | :--- | :--- |
| **Chapter Card / Shock Stamp** | Deep Sub-Bass Thud | `sfx/impact-bass-1.mp3` (-8dB) |
| **Mouse Click on UI / Button** | Crisp Mouse Click | `sfx/mouse-click.mp3` (-12dB) |
| **Code Typing / Prompt Reveal** | Mechanical Keyboard Clicks | `sfx/typing.mp3` (-16dB) |
| **Node Card Pop-in** | Tactile Soft Pop | `tools/hyperframes/assets/pop.mp3` (-10dB) |
| **System Alert / Badge Ping** | Clean iOS Chime | `tools/hyperframes/assets/notification.mp3` (-12dB) |
| **Paper Slide / Scene Wipe** | Subtle Paper Edge Friction | `sfx/paper-slide.mp3` (-14dB) |

---

## 8. THE 20 AUTO-CONTEXT VISUAL TRIGGER ARCHETYPES

Whenever the script mentions any of these 20 topics, the corresponding visual block MUST be automatically instantiated:

1. **Website / App Demo:** `browser-device-stage` with dynamic scroll & cursor pop.
2. **Terminal / Script / Python:** Glowing dark terminal typing live syntax.
3. **Smartphone / Mobile App:** 3D floating iPhone with live mockup inside.
4. **Revenue / Crores / Profit:** Fast ticking number count-up (`apple-money-count`).
5. **Growth / Analytics:** Upward neon trendline or bar chart race.
6. **Danger / Loss / Scam:** Red siren alert badge, downward crash curve, micro glitch.
7. **Before vs After:** Interactive vertical wipe slider (`before-after-wipe`).
8. **Time / 5 Minutes / Fast:** Animated conic countdown ring with stopwatch tick.
9. **Tweet / X Post:** Authentic dark-mode Twitter card with blue verified checkmark.
10. **Reddit Discussion:** Reddit card with upvote ticker incrementing.
11. **Client Chat / WhatsApp:** Realistic chat thread bubbles popping with chime.
12. **AI Pipeline / Architecture:** Glowing node-to-node connecting wires with traveling data pulses.
13. **Breaking News:** Lower-third scrolling news ticker.
14. **System Scan / AI Analysis:** Telemetry HUD with pulsing radar grid.
15. **Audio Note / Voice Note:** Reactive oscilloscope waveform.
16. **AI Disruption / Glitch:** RGB chromatic aberration split.
17. **Satisfying Stream:** Split screen with speaker top, dynamic visual bottom.
18. **Beat Drop:** Flash-through-white frame transition.
19. **Isolated Cutout:** Background cutout placed on 3D cyber grid.
20. **Outro / CTA:** Glassmorphic social follow card with pulsing highlight ring.

---

## 9. PRE-FLIGHT VALIDATION & 8-WORKER RENDER PIPELINE

Before any final render is produced, the pipeline must pass:

```bash
# 1. Validate composition syntax and assets
npm run check

# 2. Snapshot inspection at key moments (e.g., 2s, 10s, 30s)
npx --yes hyperframes@0.8.85 snapshot --at 2.0,10.0,30.0 --no-end -o snapshots_check

# 3. High-Speed 8-Worker Parallel Chromium Render
npx --yes hyperframes@0.8.85 render --workers 8 -o output_master.mp4
```

> **Hardware Specs:** 13th Gen Intel Core i7-1355U (10 Cores, 12 Threads), Intel Iris Xe Graphics. Render time for a 60s reel: ~3.5 minutes.

---
**Summary for Claude Opus 5.5:** Whenever Ratnakar asks to edit, script, plan, or render a video, adopt this document as your internal law. Treat every video as a high-retention, high-ticket masterwork.
