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

## Phases

| # | Area | What moves | Hard parts |
|---|------|------------|------------|
| 0 | Base | config, errors, MongoDB, storage, forwarding, file serving | done |
| 1 | Projects & media | create/patch (settings rules), uploads + ffprobe + thumbnails, clip order, delete media | settings validation (zod) |
| 2 | Music analysis | beats (Essentia, essentia.js), exact hits, strong/medium beats, drops, sections, events, analysis JSON, waveform, markers | rebuilding the librosa math on Essentia algorithms; same results as the tests |
| 3 | Timeline & editor | timeline model + ops, undo/redo, auto-cut, keyframes, preview hints | many ops; port the Python tests |
| 4 | Jobs & rendering | job queue (worker threads), FFmpeg filter graphs (cutter, keyframes, stabilisation), renderer, final check | long jobs, progress, cancel |
| 5 | Video analysis | shake, framing, scenes, quality (OpenCV today) | FFmpeg filters (scdet, vidstab, signalstats) or opencv.js |
| 6 | AI | providers (OpenAI, Gemini, Claude, Ollama), director, AI timeline, captions (Whisper), voices | Whisper: whisper.cpp or a transcription API |
| 7 | The rest | auth, billing, publish, brands, templates, trends, story, product, songs, admin | many small endpoints |
| 8 | Delete Python | remove the fallback, `backend/`, Python docs and scripts | - |

## Endpoints (171) - [x] = served by Next.js: 31 of 171

### admin (4)

- [ ] `PUT /api/admin/pricing`
- [ ] `PUT /api/admin/retention`
- [ ] `POST /api/admin/retention/run`
- [ ] `GET /api/admin/session`

### ai (8)

- [ ] `GET /api/ai/config`
- [ ] `PUT /api/ai/config`
- [ ] `PUT /api/ai/model`
- [ ] `GET /api/ai/models`
- [ ] `POST /api/ai/models/test`
- [ ] `GET /api/ai/providers/{provider}/models`
- [ ] `POST /api/ai/test`
- [ ] `GET /api/ai/usage`

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

- [ ] `GET /api/brands`
- [ ] `POST /api/brands`
- [ ] `DELETE /api/brands/{brand_id}`
- [ ] `GET /api/brands/{brand_id}`
- [ ] `PATCH /api/brands/{brand_id}`
- [ ] `GET /api/brands/{brand_id}/logo`
- [ ] `POST /api/brands/{brand_id}/logo`

### chat (2)

- [ ] `POST /api/chat`
- [ ] `POST /api/chat/files`

### credits (1)

- [ ] `GET /api/credits`

### dashboard (1)

- [ ] `GET /api/dashboard`

### director (3)

- [ ] `DELETE /api/director/profile`
- [ ] `GET /api/director/profile`
- [ ] `PUT /api/director/profile`

### editor (1)

- [x] `GET /api/editor/catalog`

### export-presets (1)

- [x] `GET /api/export-presets`

### hardware (1)

- [ ] `GET /api/hardware`

### health (1)

- [ ] `GET /api/health`

### insights (1)

- [ ] `GET /api/insights`

### jobs (1)

- [ ] `GET /api/jobs/{job_id}`

### library (3)

- [ ] `GET /api/library`
- [ ] `POST /api/library/search`
- [ ] `PATCH /api/library/{media_id}`

### phone (1)

- [ ] `GET /api/phone`

### plans (1)

- [ ] `GET /api/plans`

### posts (1)

- [ ] `DELETE /api/posts/{post_id}`

### product (1)

- [ ] `GET /api/product/styles`

### projects (5)

- [x] `GET /api/projects`
- [x] `POST /api/projects`
- [x] `DELETE /api/projects/{project_id}`
- [x] `GET /api/projects/{project_id}`
- [x] `PATCH /api/projects/{project_id}`

### projects/ai-timeline (1)

- [ ] `POST /api/projects/{project_id}/ai-timeline`

### projects/analysis-json (1)

- [ ] `GET /api/projects/{project_id}/analysis-json`

### projects/analyze (1)

- [ ] `POST /api/projects/{project_id}/analyze`

### projects/apply-brand (1)

- [ ] `POST /api/projects/{project_id}/apply-brand`

### projects/apply-template (1)

- [ ] `POST /api/projects/{project_id}/apply-template`

### projects/audio (1)

- [x] `POST /api/projects/{project_id}/audio`

### projects/beat-map (1)

- [ ] `GET /api/projects/{project_id}/beat-map`

### projects/beat-plan (1)

- [ ] `GET /api/projects/{project_id}/beat-plan`

### projects/duplicate (1)

- [ ] `POST /api/projects/{project_id}/duplicate`

### projects/feedback (1)

- [ ] `POST /api/projects/{project_id}/feedback`

### projects/generate (1)

- [ ] `POST /api/projects/{project_id}/generate`

### projects/generations (1)

- [ ] `GET /api/projects/{project_id}/generations`

### projects/images (3)

- [x] `POST /api/projects/{project_id}/images`
- [x] `PUT /api/projects/{project_id}/images/order`
- [x] `DELETE /api/projects/{project_id}/images/{media_id}`

### projects/jobs (3)

- [ ] `GET /api/projects/{project_id}/jobs`
- [ ] `GET /api/projects/{project_id}/jobs/{job_id}`
- [ ] `POST /api/projects/{project_id}/jobs/{job_id}/cancel`

### projects/media (2)

- [x] `GET /api/projects/{project_id}/media/{media_id}/file`
- [x] `GET /api/projects/{project_id}/media/{media_id}/thumbnail`

### projects/output (1)

- [ ] `GET /api/projects/{project_id}/output`

### projects/posts (1)

- [ ] `GET /api/projects/{project_id}/posts`

### projects/preview (1)

- [x] `GET /api/projects/{project_id}/preview`

### projects/product (2)

- [ ] `POST /api/projects/{project_id}/product/generate`
- [ ] `POST /api/projects/{project_id}/product/plan`

### projects/purge-media (1)

- [ ] `POST /api/projects/{project_id}/purge-media`

### projects/quality-check (1)

- [ ] `POST /api/projects/{project_id}/quality-check`

### projects/quality-fix (1)

- [ ] `POST /api/projects/{project_id}/quality-fix`

### projects/reference-reel (3)

- [ ] `DELETE /api/projects/{project_id}/reference-reel`
- [ ] `GET /api/projects/{project_id}/reference-reel`
- [ ] `POST /api/projects/{project_id}/reference-reel`

### projects/render (1)

- [ ] `POST /api/projects/{project_id}/render`

### projects/renderings (5)

- [ ] `GET /api/projects/{project_id}/renderings`
- [x] `GET /api/projects/{project_id}/renderings/{rendering_id}/file`
- [ ] `PUT /api/projects/{project_id}/renderings/{rendering_id}/performance`
- [ ] `POST /api/projects/{project_id}/renderings/{rendering_id}/publish`
- [x] `POST /api/projects/{project_id}/renderings/{rendering_id}/restore`

### projects/revise (1)

- [ ] `POST /api/projects/{project_id}/revise`

### projects/script (5)

- [ ] `GET /api/projects/{project_id}/script`
- [ ] `PUT /api/projects/{project_id}/script`
- [ ] `POST /api/projects/{project_id}/script/generate`
- [ ] `POST /api/projects/{project_id}/script/hooks`
- [ ] `POST /api/projects/{project_id}/script/revise`

### projects/song-analysis (1)

- [ ] `GET /api/projects/{project_id}/song-analysis`

### projects/song-parts (1)

- [ ] `GET /api/projects/{project_id}/song-parts`

### projects/split (1)

- [ ] `POST /api/projects/{project_id}/split`

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
- [ ] `POST /api/projects/{project_id}/timeline/auto-cut`
- [ ] `GET /api/projects/{project_id}/timeline/markers`
- [ ] `POST /api/projects/{project_id}/timeline/markers`
- [x] `POST /api/projects/{project_id}/timeline/ops`
- [ ] `GET /api/projects/{project_id}/timeline/preview-hints`
- [x] `POST /api/projects/{project_id}/timeline/redo`
- [x] `POST /api/projects/{project_id}/timeline/start`
- [x] `POST /api/projects/{project_id}/timeline/undo`

### projects/understand (1)

- [ ] `POST /api/projects/{project_id}/understand`

### projects/variations (1)

- [ ] `POST /api/projects/{project_id}/variations`

### projects/videos (3)

- [x] `POST /api/projects/{project_id}/videos`
- [x] `PUT /api/projects/{project_id}/videos/order`
- [x] `DELETE /api/projects/{project_id}/videos/{media_id}`

### projects/voice (2)

- [ ] `DELETE /api/projects/{project_id}/voice`
- [ ] `POST /api/projects/{project_id}/voice/generate`

### public (2)

- [ ] `POST /api/public/billing/webhook`
- [ ] `GET /api/public/reels/{token}`

### publish (1)

- [ ] `GET /api/publish/connections`

### queue (1)

- [x] `GET /api/queue`

### references (6)

- [ ] `GET /api/references`
- [ ] `POST /api/references`
- [ ] `DELETE /api/references/{ref_id}`
- [ ] `PATCH /api/references/{ref_id}`
- [ ] `POST /api/references/{ref_id}/videos`
- [ ] `DELETE /api/references/{ref_id}/videos/{index}`

### retention (1)

- [ ] `GET /api/retention`

### site (1)

- [ ] `GET /api/site`

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

- [ ] `GET /api/styles`
- [ ] `GET /api/styles/{style_id}`

### templates (7)

- [ ] `GET /api/templates`
- [ ] `POST /api/templates`
- [ ] `POST /api/templates/generate`
- [ ] `POST /api/templates/generate-from-chat`
- [ ] `DELETE /api/templates/{template_id}`
- [ ] `PATCH /api/templates/{template_id}`
- [ ] `PUT /api/templates/{template_id}/favorite`

### trend-library (4)

- [ ] `DELETE /api/trend-library`
- [ ] `GET /api/trend-library`
- [ ] `POST /api/trend-library/group`
- [ ] `POST /api/trend-library/learn`

### trends (1)

- [ ] `GET /api/trends`

### v1 (5)

- [ ] `POST /api/v1/audio/analyze`
- [ ] `POST /api/v1/reels/plan`
- [ ] `POST /api/v1/reels/render`
- [ ] `GET /api/v1/reels/{reel_id}/status`
- [ ] `POST /api/v1/video/analyze`

### variation-strategies (1)

- [ ] `GET /api/variation-strategies`

### voices (6)

- [ ] `GET /api/voices`
- [ ] `POST /api/voices`
- [ ] `GET /api/voices/system`
- [ ] `DELETE /api/voices/{voice_id}`
- [ ] `PATCH /api/voices/{voice_id}`
- [ ] `POST /api/voices/{voice_id}/preview`
