# Migration: Python backend -> Next.js (one full-stack app)

Branch: `feat/nextjs-fullstack`. Goal: the whole backend (171 API endpoints, jobs, rendering, music and video
analysis, AI) runs inside the Next.js app; the Python backend is deleted at the end.

## How it works while the move runs

- **Same URLs.** Next.js route handlers in `frontend/app/api/**/route.ts` answer the same `/api/...` paths with the
  same JSON (field for field, checked against the Python responses), so the screens do not change.
- **Python as the fallback.** Any `/api` path without a route handler is passed on to Python
  (`next.config.ts` -> `rewrites().fallback`). A route file takes over *every* method of its path, so methods not
  moved yet on a moved path are forwarded explicitly (`toPython` in `server/core/http.ts`).
- **Uploads stream.** A rewrite buffers the request body and cuts it at 10 MB, so every upload path has a route file
  that streams the body on (`forwardAll`) until it is moved.
- **The app calls its own server** (`lib/api.ts`: `API_URL` = same origin). This also fixes phones on the same Wi-Fi.
- **Each area is cut over when it is rebuilt and tested**; when nothing is forwarded any more, `backend/` is deleted.

## Layout

```
frontend/
  app/                 pages + app/api/**/route.ts (thin: parse the request, call server/, return JSON)
  server/              the backend (server-only code)
    core/              config (.env at the repo root), errors (same JSON error model), db (MongoDB), http, ffmpeg
    storage/           files under STORAGE_PATH (same layout as before)
    projects/ media/   ... one folder per area, as they move: audio/ video/ jobs/ timeline/ ai/ ...
  components/          atomic design
    atoms/             smallest pieces: Button styles, Card, Spinner, StatusBadge, ThemeToggle
    molecules/         small groups with one job: ErrorBanner, EmptyState, PageHeader, Dropzone, Stepper, pickers...
    organisms/         features: CreateReelForm, BeatMap, ... organisms/studio (editor), organisms/editor (panels)
    templates/         page frames: AppShell, Providers
  lib/ hooks/ types/   client helpers, react-query hooks, API types
```

## Decisions

- **Music analysis: Essentia** (essentia.js, in the Node server) tracks the beats; the feature maths the tuned rules
  use (onset strength, RMS, chroma, MFCC, spectra) is a TypeScript port of librosa's, checked against librosa.
- **Rendering: Remotion + FFmpeg helpers** (chosen 2026-10-13). Remotion renders the Reel from the same React
  components as the editor preview, so the preview is the export. FFmpeg stays only where Remotion cannot do the job:
  stabilising shaky clips (vid.stab), smooth slow motion (frame interpolation), probing uploads, thumbnails, decoding
  songs. Note: Remotion needs a paid company license for companies with more than 3 employees.

## Phases

| # | Area | What moves | Hard parts |
|---|------|------------|------------|
| 0 | Base | config, errors, MongoDB, storage, forwarding, file serving | done |
| 1 | Projects & media | create/patch (settings rules), uploads + ffprobe + thumbnails, clip order, delete media | settings validation (zod) |
| 2 | Music analysis | beats (Essentia, essentia.js), exact hits, strong/medium beats, drops, sections, events, analysis JSON, waveform, markers | rebuilding the librosa math on Essentia algorithms; same results as the tests |
| 3 | Timeline & editor | timeline model + ops, undo/redo, auto-cut, keyframes, preview hints | many ops; port the Python tests |
| 4 | Jobs & rendering | job queue (worker threads), Remotion compositions shared with the editor preview, FFmpeg pre-passes (stabilise, interpolate), final check | render speed, long jobs, progress, cancel |
| 5 | Video analysis | done: opencv.js (WebAssembly) + FFmpeg frame decoding - padding, exposure, sharpness, motion, phase-correlation camera shift, Haar faces (worker pool), saliency, shot size, composition, moments, best segments, duplicate uploads | speed: ~36 s for a 15 s 1080p clip on 4 cores (Haar is slow in WebAssembly; YuNet would be faster); clip understanding (vision model) waits for phase 6 |
| 6 | AI | providers (OpenAI, Gemini, Claude, Ollama), director, AI timeline, captions (Whisper), voices | Whisper: whisper.cpp or a transcription API |
| 7 | The rest | auth, billing, publish, brands, templates, trends, story, product, songs, admin | many small endpoints |
| 8 | Delete Python | remove the fallback, `backend/`, Python docs and scripts | - |

## Endpoints (171) - [x] = served by Next.js: 142 of 171

### admin (4)

- [x] `PUT /api/admin/pricing`
- [x] `PUT /api/admin/retention`
- [x] `POST /api/admin/retention/run`
- [x] `GET /api/admin/session`

### ai (8)

- [x] `GET /api/ai/config`
- [x] `PUT /api/ai/config`
- [x] `PUT /api/ai/model`
- [x] `GET /api/ai/models`
- [ ] `POST /api/ai/models/test`
- [x] `GET /api/ai/providers/{provider}/models`
- [x] `POST /api/ai/test`
- [x] `GET /api/ai/usage`

### auth (9)

- [ ] `POST /api/auth/delete-account`
- [ ] `POST /api/auth/forgot`
- [ ] `POST /api/auth/login`
- [ ] `POST /api/auth/logout`
- [ ] `POST /api/auth/logout-everywhere`
- [ ] `GET /api/auth/me`
- [ ] `POST /api/auth/password`
- [ ] `POST /api/auth/register`
- [ ] `POST /api/auth/reset`

### billing (3)

- [ ] `POST /api/billing/order`
- [ ] `GET /api/billing/payments`
- [ ] `POST /api/billing/verify`

### brands (7)

- [x] `GET /api/brands`
- [x] `POST /api/brands`
- [x] `DELETE /api/brands/{brand_id}`
- [x] `GET /api/brands/{brand_id}`
- [x] `PATCH /api/brands/{brand_id}`
- [x] `GET /api/brands/{brand_id}/logo`
- [x] `POST /api/brands/{brand_id}/logo`

### chat (2)

- [ ] `POST /api/chat`
- [ ] `POST /api/chat/files`

### credits (1)

- [ ] `GET /api/credits`

### dashboard (1)

- [x] `GET /api/dashboard`

### director (3)

- [x] `DELETE /api/director/profile`
- [x] `GET /api/director/profile`
- [x] `PUT /api/director/profile`

### editor (1)

- [x] `GET /api/editor/catalog`

### export-presets (1)

- [x] `GET /api/export-presets`

### hardware (1)

- [x] `GET /api/hardware`

### health (1)

- [x] `GET /api/health`

### insights (1)

- [x] `GET /api/insights`

### jobs (1)

- [x] `GET /api/jobs/{job_id}`

### library (3)

- [x] `GET /api/library`
- [x] `POST /api/library/search`
- [x] `PATCH /api/library/{media_id}`

### phone (1)

- [x] `GET /api/phone`

### plans (1)

- [x] `GET /api/plans`

### posts (1)

- [x] `DELETE /api/posts/{post_id}`

### product (1)

- [ ] `GET /api/product/styles`

### projects (5)

- [x] `GET /api/projects`
- [x] `POST /api/projects`
- [x] `DELETE /api/projects/{project_id}`
- [x] `GET /api/projects/{project_id}`
- [x] `PATCH /api/projects/{project_id}`

### projects/ai-timeline (1)

- [x] `POST /api/projects/{project_id}/ai-timeline`

### projects/analysis-json (1)

- [x] `GET /api/projects/{project_id}/analysis-json`

### projects/analyze (1)

- [x] `POST /api/projects/{project_id}/analyze`

### projects/apply-brand (1)

- [x] `POST /api/projects/{project_id}/apply-brand`

### projects/apply-template (1)

- [x] `POST /api/projects/{project_id}/apply-template`

### projects/audio (1)

- [x] `POST /api/projects/{project_id}/audio`

### projects/beat-map (1)

- [x] `GET /api/projects/{project_id}/beat-map`

### projects/beat-plan (1)

- [x] `GET /api/projects/{project_id}/beat-plan`

### projects/duplicate (1)

- [x] `POST /api/projects/{project_id}/duplicate`

### projects/feedback (1)

- [x] `POST /api/projects/{project_id}/feedback`

### projects/generate (1)

- [x] `POST /api/projects/{project_id}/generate`

### projects/generations (1)

- [x] `GET /api/projects/{project_id}/generations`

### projects/images (3)

- [x] `POST /api/projects/{project_id}/images`
- [x] `PUT /api/projects/{project_id}/images/order`
- [x] `DELETE /api/projects/{project_id}/images/{media_id}`

### projects/jobs (3)

- [x] `GET /api/projects/{project_id}/jobs`
- [x] `GET /api/projects/{project_id}/jobs/{job_id}`
- [x] `POST /api/projects/{project_id}/jobs/{job_id}/cancel`

### projects/media (2)

- [x] `GET /api/projects/{project_id}/media/{media_id}/file`
- [x] `GET /api/projects/{project_id}/media/{media_id}/thumbnail`

### projects/output (1)

- [x] `GET /api/projects/{project_id}/output`

### projects/posts (1)

- [x] `GET /api/projects/{project_id}/posts`

### projects/preview (1)

- [x] `GET /api/projects/{project_id}/preview`

### projects/product (2)

- [ ] `POST /api/projects/{project_id}/product/generate`
- [ ] `POST /api/projects/{project_id}/product/plan`

### projects/purge-media (1)

- [x] `POST /api/projects/{project_id}/purge-media`

### projects/quality-check (1)

- [x] `POST /api/projects/{project_id}/quality-check`

### projects/quality-fix (1)

- [x] `POST /api/projects/{project_id}/quality-fix`

### projects/reference-reel (3)

- [x] `DELETE /api/projects/{project_id}/reference-reel`
- [x] `GET /api/projects/{project_id}/reference-reel`
- [x] `POST /api/projects/{project_id}/reference-reel`

### projects/render (1)

- [x] `POST /api/projects/{project_id}/render`

### projects/renderings (5)

- [x] `GET /api/projects/{project_id}/renderings`
- [x] `GET /api/projects/{project_id}/renderings/{rendering_id}/file`
- [x] `PUT /api/projects/{project_id}/renderings/{rendering_id}/performance`
- [x] `POST /api/projects/{project_id}/renderings/{rendering_id}/publish`
- [x] `POST /api/projects/{project_id}/renderings/{rendering_id}/restore`

### projects/revise (1)

- [x] `POST /api/projects/{project_id}/revise`

### projects/script (5)

- [x] `GET /api/projects/{project_id}/script`
- [x] `PUT /api/projects/{project_id}/script`
- [x] `POST /api/projects/{project_id}/script/generate`
- [x] `POST /api/projects/{project_id}/script/hooks`
- [x] `POST /api/projects/{project_id}/script/revise`

### projects/song-analysis (1)

- [x] `GET /api/projects/{project_id}/song-analysis`

### projects/song-parts (1)

- [x] `GET /api/projects/{project_id}/song-parts`

### projects/split (1)

- [x] `POST /api/projects/{project_id}/split`

### projects/story (7)

- [ ] `GET /api/projects/{project_id}/story`
- [ ] `PUT /api/projects/{project_id}/story`
- [ ] `POST /api/projects/{project_id}/story/render`
- [ ] `POST /api/projects/{project_id}/story/replan`
- [ ] `GET /api/projects/{project_id}/story/scenes/{scene_id}/image`
- [ ] `POST /api/projects/{project_id}/story/scenes/{scene_id}/picture`
- [ ] `POST /api/projects/{project_id}/story/scenes/{scene_id}/upload`

### projects/timeline (9)

- [x] `GET /api/projects/{project_id}/timeline`
- [x] `POST /api/projects/{project_id}/timeline/auto-cut`
- [x] `GET /api/projects/{project_id}/timeline/markers`
- [x] `POST /api/projects/{project_id}/timeline/markers`
- [x] `POST /api/projects/{project_id}/timeline/ops`
- [x] `GET /api/projects/{project_id}/timeline/preview-hints`
- [x] `POST /api/projects/{project_id}/timeline/redo`
- [x] `POST /api/projects/{project_id}/timeline/start`
- [x] `POST /api/projects/{project_id}/timeline/undo`

### projects/understand (1)

- [x] `POST /api/projects/{project_id}/understand`

### projects/variations (1)

- [x] `POST /api/projects/{project_id}/variations`

### projects/videos (3)

- [x] `POST /api/projects/{project_id}/videos`
- [x] `PUT /api/projects/{project_id}/videos/order`
- [x] `DELETE /api/projects/{project_id}/videos/{media_id}`

### projects/voice (2)

- [x] `DELETE /api/projects/{project_id}/voice`
- [x] `POST /api/projects/{project_id}/voice/generate`

### public (2)

- [ ] `POST /api/public/billing/webhook`
- [x] `GET /api/public/reels/{token}`

### publish (1)

- [x] `GET /api/publish/connections`

### queue (1)

- [x] `GET /api/queue`

### references (6)

- [x] `GET /api/references`
- [x] `POST /api/references`
- [x] `DELETE /api/references/{ref_id}`
- [x] `PATCH /api/references/{ref_id}`
- [x] `POST /api/references/{ref_id}/videos`
- [x] `DELETE /api/references/{ref_id}/videos/{index}`

### retention (1)

- [x] `GET /api/retention`

### site (1)

- [x] `GET /api/site`

### songs (6)

- [x] `GET /api/songs`
- [x] `POST /api/songs`
- [x] `POST /api/songs/import`
- [x] `DELETE /api/songs/{song_id}`
- [x] `GET /api/songs/{song_id}/file`
- [x] `POST /api/songs/{song_id}/used`

### story (2)

- [ ] `POST /api/story`
- [ ] `GET /api/story/options`

### styles (2)

- [x] `GET /api/styles`
- [x] `GET /api/styles/{style_id}`

### templates (7)

- [x] `GET /api/templates`
- [x] `POST /api/templates`
- [x] `POST /api/templates/generate`
- [x] `POST /api/templates/generate-from-chat`
- [x] `DELETE /api/templates/{template_id}`
- [x] `PATCH /api/templates/{template_id}`
- [x] `PUT /api/templates/{template_id}/favorite`

### trend-library (4)

- [x] `DELETE /api/trend-library`
- [x] `GET /api/trend-library`
- [x] `POST /api/trend-library/group`
- [x] `POST /api/trend-library/learn`

### trends (1)

- [x] `GET /api/trends`

### v1 (5)

- [x] `POST /api/v1/audio/analyze`
- [x] `POST /api/v1/reels/plan`
- [x] `POST /api/v1/reels/render`
- [x] `GET /api/v1/reels/{reel_id}/status`
- [x] `POST /api/v1/video/analyze`

### variation-strategies (1)

- [x] `GET /api/variation-strategies`

### voices (6)

- [x] `GET /api/voices`
- [x] `POST /api/voices`
- [x] `GET /api/voices/system`
- [x] `DELETE /api/voices/{voice_id}`
- [x] `PATCH /api/voices/{voice_id}`
- [x] `POST /api/voices/{voice_id}/preview`
