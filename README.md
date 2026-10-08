# AI Reel Maker

Upload raw clips and a song, pick a style, and get a real, beat-synced **1080×1920 H.264/AAC MP4**
for Instagram Reels / YouTube Shorts / TikTok. The AI "brain" is your choice: **Gemini**, **OpenAI** or a local
[Ollama](https://ollama.com) model (fully offline). AI is optional: without it the rule-based editor makes the Reel.

**AI creative director.** With AI on, one structured call plans every shot (which moment of which clip, where to cut on
the beat, effect, transition, speed, framing, on-screen text, colour grade, CTA and post copy). A deterministic safety
layer checks and repairs every value before it touches the Timeline/EDL, which stays the single source of truth; FFmpeg
renders it. The AI never writes FFmpeg commands. See [docs/ai-upgrade-plan.md](docs/ai-upgrade-plan.md).

```
Analyze videos → Analyze music → Detect beats → Select clips → Create timeline
   → (Captions) → (AI copy) → Cut → Synchronize to beats → Transitions → 1080×1920 → Music → MP4
```

## What is built (and what is not)

| Phase | Feature | Status |
|------:|---------|--------|
| 1 | Create project (REST + dashboard) | ✅ done |
| 2 | Upload videos/audio (validation, sanitising, size limits) | ✅ done |
| 3 | Video analysis (OpenCV): brightness, sharpness, motion, shake, scene cuts, duplicates, usable windows, quality score | ✅ done |
| 4 | Audio analysis (librosa): BPM, beats, strong beats, onsets, energy, high-energy sections, drops, sections | ✅ done |
| 5 | Automatic timeline / clip selection (beat-aligned, energy-aware, diversity, no reuse) | ✅ done |
| 6 | FFmpeg render: crop, speed, zoom, transitions, audio mix, encode | ✅ done |
| 7 | Preview & download in the UI | ✅ done |
| 8 | Styles: Fast Trending, Cinematic, Luxury, Food, Travel, Custom, Auto | ✅ done (see limits) |
| 9 | Captions (faster-whisper → ASS → burned in): minimal, bold, karaoke, highlight, luxury | ✅ done (optional dependency) |
| 10 | Ollama AI: style choice, clip ordering, title/description/hashtags | ✅ done (needs `OLLAMA_MODEL`) |
| 11 | Vision AI | ✅ local multimodal model (`gemma3:4b` via Ollama) describes keyframes: scene, objects, mood, tags. Cached per clip; ~20 s/clip on CPU |
| 12 | Trend Mode | ✅ manual presets + `TrendSource` interface; a live feed plugs in with `TREND_FEED_URL` (G8) |
| A | **Editable timeline (EDL)**: trim, split, move, delete, duplicate, replace clip, speed, transition, effect, framing, music, captions; server-side **undo/redo**; version restore | ✅ done (see `docs/roadmap.md`) |
| A | **Preview → final**: 360×640 preview in seconds, then the full-quality export | ✅ done |
| A | **Quality check + Auto Fix** (repeats, short shots, duration, captions; black frames, silence, clipping, abrupt music end in the rendered file) | ✅ done |
| A | Export presets (Reel, Short, TikTok, Story, 4:5 Post, 1:1, 16:9), hardware encoders (NVENC / QSV / AMF / VideoToolbox, verified by a real test encode, CPU fallback), render queue | ✅ done |
| B | **Understanding + selection**: semantic clip analysis, relevance to the brief, story planner, editor-agent orchestrator, variation strategies (Version A-E), media library with AI search | ✅ done |
| C | **Voice, script, hooks**: 3 hook options, editable script (pauses, estimated length), offline voice (Windows SAPI) with speed/pitch/energy/emotion/pronunciation, exact line timings, Reel re-timed to the voice, music ducking, captions from the script, voice track in the timeline | ✅ done (English voices only unless you install packs) |
| C | **Audio modes**: music, voice + music, voice only, original clip audio, none | ✅ done |
| D | **Brands** (logo watermark, colours, caption look, call to action, defaults), **templates** (built-in, yours, favourites, AI-drafted with review), **duplicate / language variant** without re-uploading, posting results you type in + honest insights, workspace dashboard | ✅ done |
| E | **Change a Reel with words**: type what to change ("calmer, remove the first clip, add captions, louder music"), press *Regenerate*, get a new version (the old one is kept) | ✅ done: built-in phrase rules apply instantly; the local model only interprets what the rules do not know, and its plan needs your confirmation |
| F | **Any length and any part of the song**: 15/30/60 s presets or a custom length from 5 seconds to 10 minutes; choose exactly which part of the song the Reel uses (waveform, slider, typed start, *pick the loudest part*, play it before generating), or let the app choose | ✅ done: long Reels are joined in chunks so a 2-5 minute Reel renders reliably |
| F | **AI model picker** in Settings: list installed Ollama models (vision / reasoning badges), choose one, and *test it* on this computer | ✅ done |
| G | **Product Reel Director** (from photos): understands each product photo, plans a beat-synced micro-timeline (hook, curiosity, reveal, hero, detail, macro, payoff, call to action), then renders every frame with real camera moves, light sweeps, sparkles on genuine reflections, glow, light leaks, purposeful transitions and animated text; quality-checks its own plan; can loop | ✅ done (see "Product Reels" below for exactly what it does and does not do) |
| H | **Accent-aware editing**: strong individual drum hits inside a long shot get a quick punch on the beat (the footage carries on, nothing repeats) | ✅ done: on a real song the picture answers 43% of the strong hits, up from 24% |
| 2.1 | **Music intelligence**: song parts (intro, build, drop, chorus, verse, bridge, outro), what cuts land on in each part, loudness / brightness / rhythmic-density curves, estimated vocal presence, a per-beat timeline (section, energy, beat strength, phrase position) | ✅ done: vocal presence is an estimate (no source separation). Phase 2 plan: [docs/phase2-plan.md](docs/phase2-plan.md) |
| 2.2 | **Video intelligence**: shot size (close / medium / wide), composition, subject clarity, camera vs subject motion, empty frames, best moments (action peak, camera arrives, face appears, focus lands, subject fills the frame, reveal) and ready-made best segments per clip; product visibility for product clips | ✅ done: heuristics on the analysis frames (Haar faces, saliency), not an object detector |
| 2.3-2.5 | **Creative Director**: a project brief inferred from what you gave (nothing to fill in), a Creative Plan (concept, hook, story beats, pacing, music reading, text / effects strategy) decided before the shots, three concepts (Viral, Cinematic, Premium) planned separately, and a hook engine with up to 5 typed, scored openings | ✅ done: with AI the concept comes in the same call as the shots (no extra cost) |
| 2.6-2.8 | **Brand look, AI review, self-correction**: the brand kit's look is used automatically; every final Reel gets ten measured scores (hook, story, pacing, music sync, visual quality, brand fit, text, audio, ending, retention); below 70 it is corrected, re-rendered and re-scored (at most 3 reviews, kept only if better) | ✅ done: scores are measured, an optional AI reviewer only names fixes |
| 2.9-2.11 | **Tell the director, your edits are safe, it learns**: "change the hook", "use the drop for the reveal", "show the product earlier" as edit patches on the current edit; shots you edit by hand are locked against automatic changes; reference Reels summed up as creative traits; your preferred concept learned; every generation logged | ✅ done |
| G1 | **Production on one server**: user accounts (email + password, private studios: each user in their own database), HTTPS via Caddy, `docker-compose.prod.yml`, render queue (`MAX_CONCURRENT_JOBS`), scheduled-post runner | ✅ done: see [docs/deploy.md](docs/deploy.md). Files stay on the server disk (a Docker volume), not S3 |
| G2 | **Mobile and sharing**: installable app (PWA icons), Share button (phone share sheet), download without music + where to start the song | ✅ done |
| G3 | **Talking-to-camera mode**: cuts pauses and filler words (um, uh), word-by-word captions | ✅ done (needs faster-whisper) |
| G4 | **Long video → several Reels**: finds the best parts (whole sentences for talks, strongest moments otherwise) and makes 2-5 Reels as versions | ✅ done |
| G5 | **Quality**: stabilisation of shaky clips, smooth slow motion, sharper upscaling, automatic exposure fix | ✅ done (final export only) |
| G6 | **Natural AI voices** (Gemini TTS, many languages) next to the offline Windows voices | ✅ done (needs a Gemini key) |
| G7 | **Post and schedule** to Instagram Reels, TikTok, YouTube Shorts through their official APIs | ✅ ready for keys: shows "Not connected" until the keys are set |
| G8 | **Live trends** from a licensed trend-data feed (`TREND_FEED_URL`), shown above the built-in presets, cached hourly, outage-safe | ✅ ready for a feed: no scraping |

The larger vision in `adv_requirement.md` (multi-agent AI director, semantic video understanding, voice/script/hooks,
brand + template engine, media library, repurposing) is mapped section by section in **[docs/roadmap.md](docs/roadmap.md)**
with what is built, what is next, and what is deliberately not promised (e.g. voice cloning).

Known limitations, stated plainly:

* **Food / Travel** use the vision tags when a clip has been analysed (use *Analyse content* on the project page);
  otherwise they fall back to sharpness/brightness/motion heuristics. Vision analysis is slow on CPU (~20 s per clip).
* **Voices**: only the offline Windows voices installed on the machine are available (English on a default install). Hindi/Marathi
  scripts can be written and captioned, but a native voice needs a Windows voice pack; the Voices page shows exactly which
  languages have a voice. **Voice cloning is not implemented.** Local LLM steps (script, hooks) can take a minute or more on CPU.
* **Colour grades** are 7 presets (luxury, cinematic, warm, clean, high contrast, soft, natural), not a free colour engine
  (no exposure/temperature sliders). **Camera effects** (16): none, zoom in/out, punch, punch out, zoom pulse, pan left/right,
  tilt up/down, Ken Burns, crash zoom, shake, roll, flash, black & white. **Transitions**: all 58 FFmpeg transitions for video
  Reels; product Reels have 10 of their own (cut, match, blur, light, zoom, flash, whip left/right, dissolve, dip to black).
  The AI director is given every one of them and picks freely; anything it names that does not exist is mapped to the closest.
* **No repeated moments, only good footage**: every shot comes from a clip's good parts (not dark, blurry or shaky), and the
  same moment is never shown twice. When the footage runs out, unused parts are stretched with slow motion; only if every good
  moment is already on screen is one shown again, and then always as a visibly slowed-down replay (with a warning).
* **Not built yet**: extra effects (motion blur, grain),
  automatic splitting of one long video into many Reels (use *Duplicate* / *Language variant* today), LLM-suggested auto-fixes.
* **Long Reels**: the limit is 10 minutes. Every extra minute needs enough footage (otherwise moments repeat, and you are told) and a song at least that long (otherwise the Reel is shortened to the song, and you are told). Rendering time grows with length: a real 2-minute Reel with about 100 shots took ~2.5 minutes at fast quality on a CPU; full quality takes longer, and the render time limit scales with the Reel's length. Voice-over scripts are limited to 20 lines, so very long voice-overs are not supported yet.
* **Song part** is chosen in the browser (the waveform is decoded locally, nothing is uploaded for it). If the part you pick would run past the end of the song, it is moved earlier and you are told.
* **Change-by-words** understands a fixed vocabulary of requests (see the ideas in the UI). Vague requests ("make it dreamy") go to the local model, which is small and can misread them, so its plan is grounded in your words (it cannot pick a shot you did not mention or remove one you did not ask to remove) and needs your confirmation. Rebuilding (style/pace/new order/captions) does not carry over manual timeline edits or the voice-over; the previous version is kept.
* **Which model**: `OLLAMA_MODEL` in `.env`. `gemma3:4b` (default here) was faster and more reliable than `qwen3.5:4b` on the change-request prompt in a local test (50 s vs 109 s, and qwen invented actions nobody asked for); both write scripts in ~18 s. The app sends `think: false` so reasoning models do not stall. Swap models by editing one line.
* **Insights** only summarise the results *you* type in; nothing is fetched from social networks and nothing predicts virality.
* **Captions transcribe the music track** (lyrics/speech in the song), because the Reel's audio is the song and
  clip audio is muted. Instrumental music → no captions (a warning says so).
* **Framing**: pictures with solid padding (white/black bars, a small video on a white canvas with a burned-in title) are trimmed to the real picture automatically; wide pictures are shown whole over a blurred backdrop instead of being cut to a thin strip. Very low-resolution clips (< ~240 px of real picture) are skipped with a warning.
* **Face-aware crop** uses OpenCV Haar cascades: good for frontal faces, not a substitute for a detector model.
* **Custom style** uses balanced defaults; the API accepts `customStyle` parameters but the UI has no controls yet.
* **Slow motion** repeats frames (no optical-flow interpolation), so it can look steppy on 30 fps footage.
* **No auth / users** (the `users` collection is reserved); one local user. **Storage** is the local disk (S3/R2 slot in via
  `StorageBackend`). **Rate limiting** is in-process (single worker).
* **Docker files are written but were not run on the machine used to build this** (Docker was not installed).
  Everything else was run and tested; see "Testing".

## Quick start (no Docker)

**Run everything with one command (Windows):** double-click `start.bat` (or run it in a terminal). It checks MongoDB, starts the API on `127.0.0.1:8000` and the website on `127.0.0.1:3100`, waits until both answer and opens the browser. Stop both with `scripts\stop.bat`. Logs: `backend.log`, `backend.err.log`, `frontend.log`. It only listens on this computer.

Requirements: **Python 3.10+**, **Node 20+**, **FFmpeg + FFprobe** on `PATH`, **MongoDB** running locally.

```powershell
# Windows PowerShell (5.1 has no `&&`; run these one per line)
copy .env.example .env                 # edit as needed (never commit .env)

cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -r requirements-captions.txt   # optional: enables captions
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

# second terminal
cd frontend
npm install
npm run dev -- --port 3000             # http://localhost:3000
```

```bash
# macOS / Linux
cp .env.example .env
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && pip install -r requirements-captions.txt   # captions optional
uvicorn app.main:app --port 8000
# second terminal: cd frontend && npm install && npm run dev -- --port 3000
```

`GET http://localhost:8000/api/health` tells you whether MongoDB, FFmpeg and the AI model are reachable
(the same info is on the **Settings** page).

If your frontend runs on a port other than 3000, add it to `CORS_ORIGINS` in `.env`.

### Installing FFmpeg / MongoDB

* Windows: `winget install Gyan.FFmpeg`; MongoDB Community from mongodb.com (or the portable zip).
  The backend also finds a winget-installed FFmpeg even if `PATH` is stale; override with `FFMPEG_BIN`/`FFPROBE_BIN`.
* macOS: `brew install ffmpeg mongodb-community`. Linux: `apt install ffmpeg` + MongoDB packages.

### AI provider: Gemini, OpenAI or local Ollama

Pick the provider in **Settings → AI provider** (text model, vision model, fallback, budget, test, usage), or in `.env`:

```bash
# .env  (API keys live ONLY here, on the backend; the browser never sees them)
AI_PROVIDER=gemini                 # ollama | openai | gemini
GEMINI_API_KEY=...                 # https://aistudio.google.com
GEMINI_TEXT_MODEL=<model>          # e.g. listed in Settings once the key is set
OPENAI_API_KEY=...
OPENAI_TEXT_MODEL=<model>
OLLAMA_MODEL=<model you pulled>    # local: nothing leaves this computer
AI_FALLBACK_ENABLED=true           # optional: on a provider outage / timeout / quota error ...
AI_FALLBACK_PROVIDER=openai        # ... try this one (never for refusals or bad requests)
```

* **LOCAL AI** (Ollama): no media leaves the machine. **CLOUD AI** (Gemini/OpenAI): only compact analysis numbers and a
  few small, distinct keyframes per clip are sent (`VISION_MAX_FRAMES_PER_CLIP`, `VISION_MAX_IMAGE_SIZE`,
  `VISION_DETAIL_LEVEL`); whole videos are never uploaded. The project page shows "AI: Gemini" and the badge.
* Every AI answer is schema-constrained (OpenAI/Gemini) or JSON + schema (Ollama), validated with Pydantic, repaired once,
  and otherwise ignored (the rule-based path is used, with a warning).
* **Usage and cost**: every call is logged (`ai_usage` collection: provider, model, task, project, latency, tokens,
  estimated cost, fallback, error code; never keys). Costs come from the prices you set in `AI_MODEL_PRICES` (USD per
  1M tokens, shown in `AI_CURRENCY`); an unpriced model says "not priced". `DAILY_AI_BUDGET` / `MONTHLY_AI_BUDGET`
  pause automatic AI when used up (Reels are still made; chat and change requests keep working).
* Optional per-kind providers: `AI_TEXT_PROVIDER`, `AI_VISION_PROVIDER` (e.g. text on OpenAI, vision on Gemini).

**AI assist is on by default** when creating a Reel (quality over speed: the vision model looks at every clip — which one
is good, what it shows, the best order — before shots are picked, rather than guessing from file names). With a cloud
provider this takes seconds; a local model on a normal computer can take a few minutes per clip. **AI director** (on by
default with AI assist) lets the AI plan every shot; turn it off to keep the rule-based editor with AI hints only. The model only ever receives compact numbers
and clip names or a few small keyframes (never the whole video), its answers are validated, and if it is down or misbehaves
the Reel is still rendered with a visible warning. Choosing the **Auto** style lets it pick between the built-in styles.

## Docker

```bash
docker compose up --build          # frontend :3000, API :8000, MongoDB internal
```

Ollama stays on the host (`OLLAMA_BASE_URL=http://host.docker.internal:11434`). `NEXT_PUBLIC_API_URL` is the URL the
*browser* uses to reach the API and is baked in at build time (`docker compose build --build-arg NEXT_PUBLIC_API_URL=...`).
Build the backend without captions using `WITH_CAPTIONS=0`.

## Using it

1. **Create Reel** → name it, drop clips (reorder/remove), drop a song, choose 15/30/60 s and a style
   (optionally a trend preset, captions, AI assist) → **Generate Reel**.
2. The project page shows live per-stage progress (`analyzing_videos … rendering`), then the player with
   duration/resolution/size and **Download**, **Regenerate**, **Change style**, **Change duration**,
   **Create another version** (every version is kept).
3. **Length and song part** (Create Reel): pick 15/30/60 s or **Custom** (minutes + seconds, up to 10 minutes). After you add a song, *Which part of the song?* sits in the same Music card as the song's file and shows its waveform with a window as long as the Reel. Click or drag the window, use the slider, type a start (m:ss), or press *Pick the loudest part*: **the song plays from that spot straight away** (dragging while it plays just moves the sound, it never stops and restarts), with a moving line showing where it is, and it stops at the end of your part. Leave *Let the app choose* ticked for the automatic best part. On the project page, *Part of the song* re-cuts the Reel to another part as a new version.
4. **Change this Reel** (project page): describe what you want different and press **Regenerate**. Shot-level and mix changes (remove/move a shot, speed, effect, transition, music/voice volume, length, remove captions/watermark, fit/fill) are applied to your current edit; changes to style, pace, shot selection or adding captions rebuild the edit from your clips. Either way you get a new version and the old one stays in Versions. *Check what it will do* shows the plan without changing anything. Anything the AI model (rather than the built-in phrase rules) interpreted is shown first and applied only after you press *Apply these changes*.
5. **Edit timeline** opens the editor: shots, music, voice and text tracks; script & voice-over panel; brand + audio mode;
   undo/redo; preview then export. The project page also has **Analyse content**, **Variations**, **Duplicate / Language variant**
   and *Add posting results*. **Library**, **Templates**, **Brands** and **Voices** are in the sidebar.

## The Reel director (plan, story, quality control)

Every edited Reel now gets a **Director's plan** on its project page (and in `reelPlan` on the API):

* **Music map** (from the real analysis, exact timestamps): beats graded into four levels (subtle, normal, strong, major hit/drop), bars, four-bar phrases, drops, pauses and an energy curve (low, medium, high, very high). Level 3 and 4 beats are where cuts, zooms, text and reveals belong.
* **Cuts snap onto real accents, not just the beat grid.** Measured directly against two real Instagram Reels: their cuts sat within 0.06-0.34s of the plain metronome beat, but almost every one had a strong individual hit (a specific drum/transient) within 0.15s. A planned cut now moves onto a strong accent near it when there is one, the way a human editor actually cuts, instead of only the regular beat.
* **Content and story**: with **AI assist** on, the vision model looks at three frames of each clip and reports its category, its *stage* (ingredients, preparation, cooking, plating, finished) and whether it would make a good hook or ending. Step-by-step Reels then order clips by *what they show*, not by file name, and only tease a finished dish if a clip really shows one. Without AI assist the plan says "not analysed" and the file-name / list order is used (and disclosed).
* **Every shot** with its purpose, subject, camera, speed, transition, text, the music event it starts on and its beat level.
* **Quality control that repairs**: flicker shots (< 0.25 s) are merged, repeated footage is moved to unused footage, a cut-off ending is lengthened, transitions are varied and fitted to their shots, all before rendering. After rendering the file itself is checked: 9:16 H.264, audio present, audio/video length match, planned length, black frames and frozen frames. Anything that could not be repaired is listed, not hidden.

What it does **not** do: detect vocal entry or emphasis; understand clips without the vision model; regenerate or repair footage; re-render automatically when a black/frozen frame is found (it reports it).

## Step-by-step Reels (recipes, crafts, tutorials)

When you create a Reel (or later, under **Tools → Clip order**) choose **Step by step** instead of *Best moments*:

* Every clip appears **once, in the order the steps happened**. Choose *Automatic* (the order comes from the time in the file names — WhatsApp `... 2026-09-21 at 2.57.54 PM`, `VID-20240101-WA0005`, `IMG_20240301_101500`, `IMG_0012` — or, with AI assist on, what each clip actually shows) or **My order**: drag a clip to any position (1, 2, 5, …) or use its ↑ / ↓ buttons, on the create page or later under **Tools → Clip order**, and it is used exactly as arranged. The camera, zoom, speed and quality checks are still done by the app either way.
* The **last clip is the finale**: it gets the longest look and its end (the plated dish) is what shows.
* **Long steps are sped up** (at most 2x) so the whole action still fits; very short ones play slightly slow. Cuts still land on the beats of the music.
* The Reel is **as long as the steps need**, up to the length you chose. Two short clips do not get padded to 30 s (it says so). Very many steps stretch the Reel a little rather than flicker (about 0.7 s minimum each).
* Limits: the app cannot *see* which step a clip is, so a mis-named file goes in the wrong place until you reorder. Only the best continuous part of a very long clip is used. Add a hook or captions in the normal way.

## Product Reels (directed from photos)

**Create Reel → "Product Reel from photos".** Upload one or more product photos (JPG/PNG/WEBP), optionally a song, a hook line, a tagline and a call to action,
and choose a look (*Luxury jewellery*, *Clean product* or *Energetic*). The app works like a director, in this order:

1. **Understand** each photo: the product's outline, where the fine detail is, which spots are truly reflective, the colours, whether the background is plain or busy
   (it says how sure it is), and whether the photo is sharp enough to zoom into.
2. **Concept and timeline**: a hook that starts on a striking detail out of the dark, then curiosity (only part of the product), reveal, hero, detail and macro shots,
   a pull-back payoff and a calm call-to-action frame. Shots are 0.2-1.5 s (the ending up to 2.2 s) and **every cut lands on a beat** of your song.
3. **Camera, effects, transitions, text**: each shot gets a camera move (push in, pull out, pan, tilt, drift, hold), a purposeful transition to the next shot (focus pull,
   light, match cut, zoom, whip, flash; never the same one twice in a row), effects that each have a reason, and text as its own animated layer placed where it covers the product least.
4. **Render every frame** from your original photo, then mix with the music.
5. **Quality check** of the plan against the brief's own rules (continuous timeline, micro-moments, varied framing and transitions, restrained effects, sparkles only on real highlights,
   sharp close-ups, text off the product, loop closes). The result is shown on the project page next to the **director's shot list**: every shot with its time, purpose, camera, transition, effects and text.

**The product is protected by construction.** Each frame is one crop + uniform scale (+ at most about a degree of roll) of your original pixels. Nothing is regenerated, stretched or redrawn.

What it does **not** do (and does not pretend to):
* **No generative video.** "Generate each shot" with an AI video model is not possible offline; shots are made from your photo by camera moves and light.
* **No 3D orbit or parallax.** A flat photo has no depth. Hero shots get a *micro sway* (a degree of roll and a slow drift), and the shot list calls it that.
* **Sparkles only where the photo has real highlights** (stones, glints on metal). A matte product gets none, and the plan says so.
* **Close-ups are limited by photo resolution** (never enlarged more than 2.6x). Use photos of at least 1200 px for macro shots.
* **Text** is placed by the subtitle engine (FFmpeg/libass), so Hindi and Marathi shape correctly, but it depends on the fonts installed on the computer.
* Product Reels have their own project view (video, shot list, restyle and "direct again"). They do not use the timeline editor, Library, variations or *Change this Reel*.
* HEIC photos are not supported yet (export as JPG).

## Using it from your phone

> The in-app "send from your phone" card and QR code were removed. Phone mode below is still available as an **opt-in, off-by-default** option (start it only with the script). The simplest way to get phone clips in is option 2 (cable, Phone Link, Quick Share, cloud drive). To undo the Windows changes phone mode needs, run `scripts\undo-phone-mode-firewall.ps1` as Administrator.

Your clips are on your phone and the app runs on your computer. Two ways to get them in:

1. **Phone mode (upload straight from the phone's gallery).** With the phone and the computer on the **same Wi-Fi**, run
   `powershell -ExecutionPolicy Bypass -File scripts\start-phone-mode.ps1`, then open the address it prints (for example
   `http://192.168.1.20:3100`) in the phone's browser. **Create Reel** opens the phone's gallery for videos and its music files for the song, and the
   upload goes over your Wi-Fi. iPhone clips (HEVC/H.265 `.mov`, stored with a rotation flag) are handled: they come out upright.
   * **There is no login.** While phone mode runs, anyone on that Wi-Fi who knows the address can use the app. It is off unless you start it this way
     (`CORS_ALLOW_LAN` is `false` by default); close the two windows to turn it off. Do not use it on a public or shared network.
   * If the QR code does not appear, an older copy of the app is probably still running on port 8000 and answering first. The script now stops with a message when it finds one: close that terminal and run the script again.
   * **Phone mode needs a shared Wi-Fi *router*.** If the computer gets its internet from the phone's own hotspot, the phone is the hotspot and usually cannot open the addresses of devices connected to it (an Android limitation: the browser says "connection was interrupted"). Put the phone and the computer on the same router's Wi-Fi, or use option 2 below.
   * **Not sure what is wrong?** On the phone open `http://<computer address>:8000/phone-check` (for example `http://172.20.10.10:8000/phone-check`). It is a tiny page with no app code: if you see "Your phone reached this computer", the network and firewall are fine; it also tells you whether the phone can reach the app port (3100).
   * **If the phone cannot open the address**, Windows Firewall is blocking it (typical when the network is marked *Public*, or an earlier pop-up was cancelled, which creates "Block" rules for Node.js and Python). Run **once, as Administrator**: `powershell -ExecutionPolicy Bypass -File scripts\allow-phone-mode-firewall.ps1`. It shows what it will change and asks first: it marks the current network *Private* and adds one inbound rule for ports 3100 and 8000 on Private networks only. `start-phone-mode.ps1` warns when the network is Public.
   * Phone browsers upload big videos slowly on weak Wi-Fi; the per-file limit is 500 MB.
2. **No setup:** copy the clips to the computer first (USB cable: on a Samsung Galaxy unlock the phone, choose *File transfer* and copy from `DCIM/Camera`; or Microsoft *Phone Link*, Samsung *Quick Share* to Windows, Google Drive/OneDrive, Nearby Share / Quick Share, AirDrop for a Mac, or your own
   messaging app's "save to files"), then upload them from the computer as usual.

Not built: a native mobile app or a "Share to Reel Maker" entry in the phone's share sheet (that needs an installable app; the browser cannot register
one for videos). Untested on an actual phone: this was checked with automated tests of the network settings and a real render of a phone-style clip, not with a physical device.

## API (all under `/api`)

| Method | Path | Notes |
|---|---|---|
| GET/PUT | `/ai/config` | provider, models, fallback, budget, status, last test (never keys) |
| GET | `/ai/providers/{provider}/models` | models the provider offers |
| POST | `/ai/test` | one tiny structured call (`{"provider", "vision"}`) |
| GET | `/ai/usage` | calls / failures / estimated cost today, this week, this month, per provider |
| POST/GET | `/projects` | create / list (`?status=`) |
| GET/PATCH/DELETE | `/projects/{id}` | |
| POST | `/projects/{id}/videos` | multipart `files`; returns `{uploaded, failed}` |
| PUT | `/projects/{id}/videos/order` | reorder |
| DELETE | `/projects/{id}/videos/{mediaId}` | |
| POST | `/projects/{id}/audio` | multipart `file` |
| POST | `/projects/{id}/analyze` | job: analysis only |
| POST | `/projects/{id}/generate` | job: full render; optional overrides `{style,duration,audioStart,audioAuto,captions,captionStyle,ai,trendId,seed,label}` |
| GET | `/jobs/{id}` · `/projects/{id}/jobs/{jobId}` · `/projects/{id}/jobs` | `{status, progress, stage, stages[]}` |
| GET | `/projects/{id}/output` · `/renderings` · `/renderings/{rid}/file[?download=1]` | Range requests supported |
| GET | `/projects/{id}/timeline` | the editable EDL + `canUndo/canRedo/history` |
| POST | `/projects/{id}/timeline/ops` | batch of edit operations (all-or-nothing); `/undo` · `/redo` |
| POST | `/projects/{id}/render` | `{quality: "preview"\|"final"}` renders the *current* (edited) timeline |
| GET | `/projects/{id}/preview` | latest low-res preview |
| POST | `/projects/{id}/renderings/{rid}/restore` | make an older version's timeline current (undoable) |
| POST | `/projects/{id}/quality-check` · `/quality-fix` | find problems; apply a fix as one undoable edit |
| GET | `/export-presets` · `/hardware` · `/queue` | presets, detected encoders, jobs across projects |
| PUT/GET/POST | `/ai/model` · `/ai/models` · `/ai/models/test` | choose the Ollama model, list installed models with capabilities, grade a model on a small task |
| POST | `/projects/{id}/images` · DELETE `/images/{id}` · PUT `/images/order` | product photos (validated by decoding them) |
| POST | `/projects/{id}/product/plan` | the director's shot list, without rendering |
| POST | `/projects/{id}/product/generate` | job: direct and render a Reel from the photos (`quality: preview` for a fast look) |
| GET | `/product/styles` | Luxury jewellery / Clean product / Energetic |
| POST | `/projects/{id}/revise` | `{instruction, dryRun?, confirmedActions?}` change a finished Reel with words; returns what was understood, warnings and the render job |
| POST | `/projects/{id}/understand` · `/variations` · `/duplicate` | analyse clip content · render Version A-E · copy / language variant |
| GET/PUT | `/projects/{id}/script` · POST `/script/hooks` `/script/generate` `/script/revise` | script editor + AI |
| POST/DELETE | `/projects/{id}/voice/generate` · `/voice` | speak the script and re-time the Reel · remove |
| GET/POST/PATCH/DELETE | `/voices` · `/voices/system` · POST `/voices/{id}/preview` | voice profiles |
| GET/POST/PATCH/DELETE | `/brands` (+ `/brands/{id}/logo`) · POST `/projects/{id}/apply-brand` | brand profiles |
| GET/POST/PATCH/DELETE | `/templates` · POST `/templates/generate` · PUT `/templates/{id}/favorite` · POST `/projects/{id}/apply-template` | templates |
| GET/POST/PATCH | `/library` · POST `/library/search` · PATCH `/library/{mediaId}` | media library (filters, AI search, tags, favourites) |
| PUT | `/projects/{id}/renderings/{rid}/performance` · GET `/insights` · `/dashboard` | results you enter, insights, workspace stats |
| GET | `/styles` · `/trends` · `/variation-strategies` · `/health` | |

Errors always look like `{"error": {"code", "message", "details"}}` (e.g. `FFMPEG_RENDER_FAILED`, `FILE_TOO_LARGE`,
`UNSUPPORTED_MEDIA`, `CORRUPTED_MEDIA`, `NO_AUDIO`, `INSUFFICIENT_DISK_SPACE`, `RENDER_TIMEOUT`, `OLLAMA_UNAVAILABLE`, …).
Interactive docs: `http://localhost:8000/docs`.

## Project layout

```
backend/app/
  api/        REST routers            core/      config, errors, ffmpeg wrapper, db, rate limit
  audio/      bpm, beat_detector, analyzer      video/   analyzer, timeline, cropper, cutter,
  ai/         provider, ollama, prompts,                 transitions, composer, renderer
              clip_selector, copywriter, vision
  captions/   transcriber, cues, ass            styles/  data-only editing styles (+ registry)
  trends/     presets + TrendSource             jobs/    pipeline (sync) + manager (async, persisted)
  storage/    StorageBackend + LocalStorage     models/, schemas/, services/
frontend/     Next.js app router, components, hooks (React Query), lib/api.ts
docs/         architecture + extension guide
```

More: [docs/architecture.md](docs/architecture.md), [docs/extending.md](docs/extending.md).

## Testing

```bash
cd backend  && pytest -m "not live"   # real FFmpeg renders (marked `slow`), MongoDB mocked, AI providers mocked
cd frontend && npm test               # Vitest + React Testing Library
cd frontend && npm run typecheck && npx eslint .
```

The backend tests generate their own media (FFmpeg `lavfi` clips, a 120 BPM click-track MP3) and render real
reels: the acceptance test renders 5 clips + MP3 + 15 s + Fast Trending, then checks codec, 1080×1920, duration,
that every frame decodes with zero errors, and that temp files are cleaned up.
`pytest -m "not slow"` skips the render tests. The AI provider contract tests (`tests/test_ai_providers.py`) run the
same checks against Ollama, OpenAI and Gemini with mocked transports; no key is needed. Real provider calls are opt-in:
`LIVE_GEMINI_API_KEY=... LIVE_GEMINI_MODEL=... pytest tests/integration -m live` (also `LIVE_OPENAI_*`, `LIVE_OLLAMA_MODEL`).

## Security notes

Uploads are extension-checked, streamed to disk with a hard size cap, then **verified by ffprobe** (a renamed `.exe` or
corrupt file is rejected and removed); files are stored under generated ids (the original name is display-only and
sanitised). FFmpeg is only ever called with argument lists (never a shell); caption text goes into a subtitle *file*, so
transcripts cannot inject filter syntax; storage keys are traversal-checked; ids are validated; LLM output is validated
and can only reorder clips or choose among known styles. Temp files are removed after each render.
