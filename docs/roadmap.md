# Roadmap: mapping `adv_requirement.md` to phases

Legend: ✅ built and tested · 🟡 partly built · ⬜ planned (design notes below) · ❌ deliberately not done

The requirements describe an AI creative director with human review. That is built bottom-up: every AI
feature writes into **one editable, versioned Edit Decision List (EDL)**, so the human can always change the
result. That foundation is Phase A; everything else plugs into it.

## Phase A: Editable foundation (built and tested)

| § | Requirement | Status |
|---|---|---|
| 2 | Non-destructive editing (originals never modified; EDL is the source of truth) | ✅ timeline is stored instructions; renders read originals |
| 1 | Editable timeline: trim, move, split, delete, duplicate, replace, speed, transition, crop, captions, music | ✅ backend ops + editor UI (drag-to-move is buttons for now; voice track in the timeline) |
| 25 | Undo / redo | ✅ server-side history (50 snapshots) |
| 24 | Version history + restore | ✅ every render kept; restore returns the timeline it was made from |
| 26 | Low-res preview → approve → final render | ✅ preview (360×640, fast) and final are separate render kinds |
| 22 | Quality checker | ✅ EDL checks + real file analysis (black frames, clipping, silence, duration, resolution, repeats, short clips, captions) |
| 23 | Auto-fix | 🟡 deterministic fixes for duration, repeats, short clips, clipping, abrupt music end; LLM-suggested fixes ⬜ |
| 21, 36 | Resolutions / export presets (9:16, 16:9, 1:1, 4:5; Reel, Short, TikTok, Story, Post) | ✅ |
| 28 | Hardware acceleration (NVENC, AMF, VideoToolbox, QSV) with CPU fallback | ✅ detected by a real test encode, never assumed |
| 27 | Render queue across projects | ✅ `/api/queue` |
| 20 | Colour engine (presets + exposure/contrast/saturation/temperature/highlights/shadows) | ⬜ not built (only an automatic light enhancement for soft/low-res clips) |
| 19 | Effect engine (pan, shake, motion blur, whip, light leak, grain …) | 🟡 zoom, punch, speed-ramp, slow-mo, flash, blur, fade, dissolve, slide exist; the rest ⬜ not built |

## Phase B: Understanding and selection (built and tested)

| § | Requirement | Status |
|---|---|---|
| 5, 32, 33 | Semantic video understanding, searchable media library, AI search | ✅ keyframes → local vision model (`gemma3:4b`) → scene/objects/action/mood/tags, cached per clip; Library page with tags, favourites, used/unused; AI search expands synonyms and matches whole words only. ~20 s per clip on CPU. |
| 6, 8 | Smart shot selection, story engine | ✅ relevance to the brief and semantic importance in the scorer; story planner returns JSON that becomes an *order hint* (hook → build → payoff), never executed code |
| 3, 4 | AI editor agent + multi-agent orchestrator | ✅ orchestrator picks the minimum set of small agents (analyst, story planner, style director …); each returns validated JSON; failures degrade to deterministic behaviour with a visible warning |
| 9 | Variation engine | ✅ Version A-E = different style / pace / order / caption look, analysed once |
| 10 | Audio intelligence | ✅ downbeats, bars, phrases, drops, energy, plus (Phase 2.1) labelled song parts (intro/build/drop/chorus/verse/bridge/outro) with a cut strategy each, loudness / brightness / rhythmic-density curves and an *estimated* vocal presence (no source separation). See [phase2-plan.md](phase2-plan.md) |

## Phase C: Voice, script, hooks, captions (built and tested)

| § | Requirement | Status / honest limits |
|---|---|---|
| 7, 12, 13 | Hook generator (3 options), script editor, automatic voice timing | ✅ hooks, editable script with pauses, Generate / Shorten / Make natural / Make energetic / Regenerate; the Reel is re-timed from the *measured* voice length |
| 11 | Voice system | ✅ `VoiceProvider` interface + offline Windows SAPI (speed, pitch, energy, emotion via SSML prosody, pronunciation dictionary, pause style). Only installed voices exist (English by default; Hindi/Marathi need a voice pack, and the UI says so). **Voice cloning is not implemented.** |
| 18 | Smart music control | ✅ ducking under voice (`sidechaincompress`), fades, music window; volume and ducking editable |
| 14 | Advanced captions | 🟡 word timing + 5 presets + brand font/colour; captions can come from the script's exact line timings. Devanagari font coverage depends on installed fonts |
| 35 | Multi-language versions without re-upload | ✅ *Language variant* duplicates the project (media copied on disk, no upload) with its own script/voice/captions |
| 42 | All audio-mode combinations | ✅ music, voice + music, voice, original clip audio, none |

## Phase D: Brand, templates, library, repurposing

| § | Requirement | Status |
|---|---|---|
| 15, 16, 17 | Brand engine, template engine, AI template generator | ✅ brands and templates are user data in MongoDB (nothing hard-coded); built-in templates are read-only (duplicate to edit); the AI only *drafts* a template that the user reviews before saving |
| 34 | Repurposing (1 long video → many reels) | 🟡 duplicate / language variant / variations exist; **automatic splitting of a long video is not built** |
| 37, 38 | Analytics-ready model, learning engine | ✅ the user types results in per rendering; insights group by style/length/captions/voice-over, flag small samples, and say plainly they do not predict performance |
| 29-31 | Local-first, cloud optional, privacy | ✅ nothing leaves the machine by default. Cloud providers are stubs; enabling one will show an explicit notice |
| 39 | Advanced dashboard | ✅ projects by status, templates, voices, brands, library, recently generated, favourites, most-used styles, insights |

## Phase E: Revision by instruction (built and tested)

| Requirement | Status |
|---|---|
| Change a finished Reel by typing what to change, then Regenerate | ✅ `POST /projects/{id}/revise`. Deterministic phrase rules first (offline, instant); the local LLM only for the clauses the rules did not understand. |
| The LLM never executes anything | ✅ its JSON is validated into a fixed action vocabulary, clamped, and *grounded in the user's own words* (no invented shot numbers, no removals nobody asked for), then translated into the same validated EDL operations the editor uses |
| No surprise changes | ✅ AI-interpreted plans are shown and applied only after confirmation; the confirmed plan is re-validated server-side; each change is one undoable edit and a labelled new version |
| Style / pace / new order / add captions | 🟡 these rebuild the edit from the clips (manual edits and voice-over are not carried over; warned before applying) |

## Phase F: Length and music (built and tested)

| Requirement | Status |
|---|---|
| Custom Reel length (2 min, 5 min ...) | ✅ 5 s to 10 min. Reels with more than 24 shots are composed in chunks of 16 (then the chunks are joined with the same transitions), because one filter graph over hundreds of inputs is slow and memory hungry. A test proves the chunked result matches the flat join (same length, PSNR > 30 dB, audio intact) |
| Choose the part of the song | ✅ `audioStart` setting; the timeline is cut to the beats of that part; kept inside the song with a visible warning; automatic remains the default |
| Choose the AI model | ✅ Settings page + `/api/ai/*`; the choice is saved in the storage folder and overrides `OLLAMA_MODEL`; a model test reports time and whether the model understood a small request |
| Long voice-over scripts | ⬜ script editor is capped at 20 lines |

## Phase G: Product Reel Director (built and tested)

Mapping of the "expert short-form video director" brief:

| Brief section | Status |
|---|---|
| 1 Understand the source | ✅ subject outline, detail regions, reflective highlights, palette, background, sharpness (classical image analysis; says how sure it is). Materials/depth layers/logos are **not** recognised. |
| 2 Reel concept | ✅ hook, story and ending are planned per Reel (rule-based; no LLM needed) |
| 3 Timeline | ✅ a micro-timeline of 0.2-1.5 s shots with purpose, framing, camera, transition, effects, text and the beat each starts on |
| 4 Micro-motion | 🟡 push, pull, pan, tilt, drift, hold, light sweep, sparkle, blur/zoom/whip/flash transitions, speed of camera. Orbit/rotation/parallax/object reveals need depth or segmentation: not built |
| 5 Beat synchronisation | ✅ cuts on beats, sparkles/flashes on accents and drops |
| 6, 13 Attention curve, retention | ✅ fixed hook > curiosity > reveal > hero > detail > macro > payoff > cta arc; a visual change in every shot |
| 7 Camera direction | ✅ six framings, varied compositions, never the same twice in a row |
| 8 Product protection | ✅ only crop + uniform scale + light; a test proves a frame shows the photo's own pixels |
| 9 Jewellery direction | ✅ Luxury style: slow moves, sweeps across the metal, sparkles only on detected highlights |
| 10 Text animation | ✅ independent layer: fade, slide, scale, mask reveal, type-on, blur-to-sharp; kept off the product; safe area |
| 11 Transitions with purpose | ✅ chosen from the pair of shots; match cuts continue the move |
| 12 Visual effects | ✅ light leak, glow, sparkle, dust, flash; capped (never overloaded). Lens flare and bokeh are not built |
| 14 Loop | ✅ optional: the last frame returns to the first |
| 15 Final timeline output | ✅ the director's shot list on the project page and `POST /product/plan` |
| 16 "Generate each shot" | ❌ no generative video model: shots are rendered from the photo |
| Quality check | ✅ 13 checks on the plan; the render is verified by tests (playable, exact length, moving, text visible) |

## Engineering standard (§41)

Python type hints + Pydantic, strict TypeScript, service interfaces, no hard-coded brands/models/paths, background
queue rendering (API never blocks), temp-file cleanup, structured errors, unit + integration tests: in place and
kept as the bar for every phase.
