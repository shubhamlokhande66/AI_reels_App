# Phase 2: AI Video Creative Director — implementation plan

Phase 2 is built **on top of** the existing app (FastAPI + MongoDB + FFmpeg/OpenCV/librosa, Next.js frontend). Nothing is
rewritten and no REST endpoint changes shape; new data is added as optional fields. The rule stays the same as in
Phase 1: the AI decides *what* and *why* (validated Pydantic JSON); code decides *how* (Timeline/EDL → FFmpeg).

The spec's preferred stack (Node/TS backend, PostgreSQL, BullMQ, S3) is **not** adopted: the existing Python backend,
MongoDB, `JobManager` and `StorageBackend` already cover those roles, and replacing them would be the rewrite the spec
forbids. `StorageBackend` is the slot for S3/R2 later.

## 1. What already exists (reuse, do not duplicate)

| Spec § | Need | Existing code | State |
|---|---|---|---|
| 1 | Project brief / producer | `settings.brief` (free text), styles, brands, templates | 🟡 no structured brief |
| 2 | Music intelligence | `audio/analyzer.py`, `audio/structure.py`, `director/music_map.py` | ✅ **Phase 2.1 (this change)** |
| 3, 4 | Video intelligence, best moments | `video/analyzer.py` (quality, motion, shake, pan, usable windows, content rect), `ai/understanding.py` + `ai/vision.py` (vision tags, cached), `director/intelligence.py` (hook / hero scoring) | 🟡 no shot size, composition, face/product visibility scores, per-moment "events" |
| 5 | Creative Director | `ai/reel_director.py` (one structured call) + `director/ai_plan.py` (safety layer → EDL) | ✅ base; needs a separate *Creative Plan* (concept, hook, story beats) before shots |
| 6 | 3 concepts (Viral / Cinematic / Premium) | `variations/strategies.py`, `run_variations` | 🟡 rule-based restyles; concepts are not directed separately |
| 7 | Hook engine | `intelligence.rank_hooks`, `ai/script.py` text hooks | 🟡 scored internally, not exposed as 5 scored candidates |
| 8 | Story intelligence | `director/story.py`, `ai/reel_director.structure_guide` | 🟡 food/product only |
| 9, 10 | Music × visual, motion matching | `intelligence.motion_match`, energy-match in `video/timeline.py` | 🟡 no explicit compatibility score in the plan |
| 11, 12 | Transitions / effects with reasons | `video/transitions.py`, `video/effects.py`, `review._tidy_transitions` | ✅ (reason string per shot exists) |
| 13 | Text / captions | `captions/*`, `TextOverlay`, `product/textass.py` | ✅ |
| 14 | Brand kit | `api/brands.py` | ✅ (style list to align with spec names) |
| 15 | Reference Reel analysis | `trends/reference.py`, `api/references.py` | ✅ |
| 16 | Versioned, validated EDL | `models/timeline.py` (Pydantic), `video/timeline_ops.py` | 🟡 no explicit `edl_version` field |
| 17 | Deterministic renderer | `video/renderer.py`, `composer.py`, presets, HW encoders | ✅ |
| 18 | Audio mixing / ducking | `video/audio_mix.py`, `audio/sfx.py` | ✅ (voice ducking); clip-audio ducking 🟡 |
| 19 | Reviewer | `director/creative_review.py` (EDL), `review.check_render` (file) | ✅ deterministic; AI reviewer ⬜ |
| 20 | Self-correction | `creative_review.auto_revise` | 🟡 pre-render only, deterministic |
| 21 | Conversational editing / patches | `revise/actions.py`, `revise/inplace.py`, `api/revise.py` | ✅ (actions = patches) |
| 22 | Human override protection | — | ⬜ no `locked` / `manual` flag on segments |
| 23 | Personal director | `services/feedback.py` (`DirectorProfile`) | ✅ |
| 24 | Model abstraction | `ai/provider.py`, `factory.py`, Gemini/OpenAI/Claude/Ollama providers | ✅ |
| 25 | Cost / caching | analysis caches keyed by version, `ai/usage.py`, `pricing.py`, per-task model choice | ✅ |
| 26 | Privacy | `services/privacy.py`, local-first | ✅ |
| 29 | Observability | `Timeline.ai` (`AIInfo`), `ai/usage.py` | 🟡 no per-generation record (prompt version, scores, iterations) |
| 31 | Failure handling | `core/errors.py`, AI fallback to rules, upload validation | ✅ mostly; audit per step |
| 32 | UI | project page, `ReelPlanPanel`, revise box, Settings | 🟡 no concept picker / score card step |

## 2. Increments (each one a separate change, tests first-class)

### 2.1 Advanced music intelligence — ✅ done in this change
- **Created** `backend/app/audio/structure.py`: curves every 0.5 s (loudness dBFS, brightness = spectral centroid,
  rhythmic density, vocal-presence estimate), finer structure (MFCC + loudness clustering, boundaries on beats, a drop
  always starts a part), labels (intro / build / drop / chorus / verse / bridge / outro) and a default cut strategy per
  label (phrase / bar / beat / accent).
- **Modified** `models/analysis.py` (`SongSection`, curves, `section_at`, `curve_at`), `audio/analyzer.py`
  (`ANALYSIS_VERSION = 4`: cached analyses are recomputed once), `director/music_map.py` (sections + the normalized
  per-beat timeline `{time, section, energy, beatStrength, phrasePosition}`), `ai/reel_director.py` (director receives
  sections + `cut_on` + vocals and is told it may break the default; `PROMPT_VERSION = 12`), `video/timeline.py` (rule
  editor: intro / outro / bridge breathe, drops tighten), `director/plan.py`, frontend `types/api.ts` +
  `ReelPlanPanel.tsx` (song-parts strip).
- **Tests** `tests/test_music_intelligence.py`.
- Vocal presence is a heuristic (no source separation): a tonal partial whose pitch *wavers back and forth* like a
  voice. Held synth notes and falling kick-drum pitch do not count. It is labelled an estimate in the plan.

### 2.2 Advanced video intelligence — ✅ done
- **Created** `backend/app/video/shots.py`: per analysis frame (the analyzer's existing 320 px samples, no extra
  decoding): subject = largest face or else the strongest *salient* region (spectral-residual saliency), shot size
  (close / medium / wide from face height or subject area), composition for the 9:16 output (vertical placement, not
  cut by the edge, readable size, headroom), empty frames (no edges, nothing salient), camera motion (global phase
  shift) vs subject motion (what still moves after the camera shift is removed).
- **Created** `backend/app/video/moments.py`: best moments (action peak, camera settles, face appears, focus peak,
  subject close, reveal), only inside usable windows; best segments (~1-3 s spans built around them, plus each
  window's best-looking stretch, never overlapping, best first); product visibility for clips the vision model
  says show a product (product, jewelry, fashion, beauty).
- **Modified** `models/analysis.py` (window: `shot_size`, `composition`, `subject`, `camera_motion`,
  `subject_motion`, `empty`; clip: `composition_score`, `subject_score`, `camera_motion_score`,
  `subject_motion_score`, `shot_sizes`, `moments`, `best_segments`, `product_visibility`), `video/analyzer.py`
  (`VIDEO_ANALYSIS_VERSION = 3`, `clip_summary`), `ai/reel_director.py` (clip facts + prompt; `PROMPT_VERSION = 13`),
  `ai/understanding.py` (vision keyframes start from the best segments), `jobs/pipeline.py` (product visibility
  after the vision step), `director/intelligence.py` (hook clarity and hero subject use the measured subject /
  composition), frontend `types/api.ts` + project page (hover shows shot sizes, composition, best moment).
- **Tests** `tests/test_video_intelligence.py` (synthetic pan-then-hold and moving-object clips, framing, series).
- Analysis cost is unchanged (decoding dominates). Faces are Haar cascades and objects are saliency, not a detector
  model; products are known only from the vision model.

### 2.3 Creative Director (brief + Creative Plan) — ✅ done
- **Created** `director/brief.py` (`ProjectBrief`: platform, duration, objective, content type, audience, style, tone,
  CTA, brand; inferred from settings, the brief text, the brand and the vision categories, with `inferred` listing the
  guesses) and `director/creative.py` (`CreativePlan`: concept, logline, hook, story beats, pacing, visual energy, music
  interpretation, text / effects / transition strategy, ending; story structures per content type, trimmed to the
  footage; `draft_plan` for the rules, `merge_ai` for the AI's answer).
- The AI director answers `concept` in the SAME call as the shots (no extra AI cost); it receives `brief`, `brand`,
  `creative_direction` and typed `openings`. Prompt v14 (v15 with reference traits).
- Every timeline carries `brief` + `creativePlan`; the Reel plan shows them. Settings gain optional `objective`,
  `audience`, `concept`.

### 2.4 Multiple creative versions — ✅ done
- `DIRECTIONS` Viral / Cinematic / Premium differ in hook type, pacing, shot order, music reading, text, effects and
  transitions. Strategy `premium` added; `CONCEPT_SET`. With AI on, `run_variations` directs each concept separately
  (own cache key); without AI the rule-based strategies remain, each still with its own Creative Plan.

### 2.5 Hook engine — ✅ done
- `director/hooks.py`: up to 5 openings from the measured moments, typed (visual_surprise, product_reveal,
  fast_movement, curiosity, transformation, close_up, pattern_interrupt, text_hook) and scored (hook_score, clarity,
  curiosity, visual_strength); max two per clip, different kinds preferred.

### 2.6 Brand kit — ✅ done
- Brand `visualStyle` (the eight spec styles); a project left on auto style uses it; the brand goes to the brief, the
  director facts and the brand-fit score. Brand form has a "Brand look" select.

### 2.7 Reviewer agent — ✅ done
- `director/scorecard.py`: hook, story, pacing, music sync, visual quality, brand fit, text readability, audio, ending,
  retention + overall, all measured (EDL review + `quality/checker.check_render_file` on the rendered MP4).
- `ai/reviewer.py`: optional AI pass (task `reviewer`) that names fixes from a fixed vocabulary; it never scores.

### 2.8 Self-correction loop — ✅ done
- `director/self_correct.py` + `pipeline.score_and_correct`: below `REVIEW_THRESHOLD` (70) a final render is
  corrected (creative revisions + audio fixes), re-rendered and re-scored, at most `REVIEW_MAX_ITERATIONS` (3) reviews;
  a correction is kept only if the score rises. Recorded in the Reel plan (`selfCorrection`).

### 2.9 Conversational editing + human override — ✅ done
- `Segment.locked` (set by hand edits through `timeline_ops.mark_manual`; `set_lock` op to unlock). The reviewer,
  self-correction, in-place restyle / repace never change a locked shot.
- `revise/director_patch.py`: "make the first 3 seconds stronger" / "change the hook" -> `replace_hook`, "use the
  drop for the reveal" -> `move_hero_to_drop`, "show the product earlier" -> `move_product_earlier`, carried out on
  the current edit with the cuts unchanged. Every revise response lists `patches` `{operation, target, reason}`.
  "Remove unnecessary transitions" is understood.

### 2.10 Reference Reel analysis — ✅ done
- `trends/reference.traits`: pacing, average shot duration, shot density, hook length, energy curve, transition
  style, text density, camera movement, music sync, colour mood, story structure ("not_measured" when unseen). Sent to
  the director as guidance; nothing is copied.

### 2.11 Personal Creative Director + observability — ✅ done
- Feedback learns the preferred concept (accepted versions, "Use this version"), the kept shot-length range, and
  exposes a `summary` (`preferred_pacing`, `transition_preference`, `style`, `concept`, `shot_range`). A preferred
  concept is used when the person leaves it on auto.
- `services/generations.py`: one Mongo `generations` record per job (analysis versions, AI provider/model, prompt
  version, brief, creative plan, EDL version, reviewer score card, correction rounds, output);
  `GET /api/projects/{id}/generations`. Timelines carry `edlVersion: "2.0"`.

### UI — ✅ done
- `components/CreativeDirectorPanel.tsx` on the project page: steps (Upload -> AI analysis -> Creative concept ->
  Generate -> AI review -> Tell the director), brief (guesses marked), creative concept, the three concepts (generate
  one, or all three as versions), possible openings, the AI review score card and correction rounds. Versions get
  "Use this version". The existing "Change this Reel" box is the "tell the director" step.

## 2b. Validation on real footage and the real AI (Gemini)

Checked on real clips (the user's WhatsApp jewellery clips, free park/street footage, free people/face footage) and with
the configured Gemini model (`gemini-3.5-flash-lite`), not only on synthetic test video and a fake provider:

* AI director: concept answered in the same call; self-revision round; vision descriptions correct; ~6 s / 12k tokens.
* Self-correction (threshold raised for the check): reviewer named the faults, the edit was corrected and re-rendered,
  score 93 -> 95, the corrected render replaced the first; the next round found nothing more and stopped.
* AI reviewer: fixes only from its vocabulary, matching the measured issues (~5 s / 2k tokens).
* Three concepts with Gemini: different pacing (12 / 8 / 7 shots), style, transitions and text. Fixed on the way:
  every version now opens on its own clip (`creative.hooks_for`, `distinct_opening`, which trades places with a later
  shot rather than showing a moment twice), and Cinematic plays the middle of the Reel in filming order on the same
  cut times (`creative.story_order`).
* Fixed from real-footage findings: Haar "faces" in foliage (skin check + two detections in a row), action peaks on
  every frame of wind / handheld wobble (peaks judged against the clip's own movement), scenery labelled as close-up
  (strips, scattered clutter, half-frame boxes off two edges, and the focus cue), missed real faces (contrast
  equalisation, profile cascade both ways, a skin range that tolerates coloured light), a stale guessed style in the
  brief, a misleading "hero on the drop at 0.0 s" when the song part starts on the drop, and too many shots marked
  call to action.
* Still heuristic: faces are Haar cascades (frontal + profile), subjects are saliency; products are known only through
  the vision model.

## 3. Potential breaking changes and how they are handled

| Change | Risk | Mitigation |
|---|---|---|
| Audio/video analysis version bumps | first generation after upgrade re-analyses (slower once) | caches keyed by version; recomputed transparently |
| New optional fields on analyses / Timeline | old Mongo docs lack them | all fields have defaults; frontend fields optional |
| Director prompt version bump | old director cache entries unused | cache key includes `PROMPT_VERSION` |
| Self-correction re-renders | longer jobs when a Reel scores below 70 | at most 2 extra final renders, kept only if better; previews never re-render |
| Locked segments | AI fixes could seem to "not apply" | the reviewer reports issues it could not fix because a shot is locked |
