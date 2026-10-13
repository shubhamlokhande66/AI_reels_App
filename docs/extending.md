# Extending the system

Everything runs in the Next.js app (`frontend/`); the server code is in `frontend/server/`. Nothing below requires
touching the rendering engine.

## Add an editing style
Styles are data: add an entry to `frontend/server/styles/builtin.json` (the fields are the `EditingStyle` interface in
`server/styles/index.ts`: cut beats, segment lengths, transition and effect weights, motion preference, grade ...).
It shows up in `/api/styles` automatically; add its label to `frontend/lib/format.ts` (`STYLE_LABELS`).

## Add a transition
`frontend/server/video/render/parts.ts`: add a row to the transition table (`[name, "xfade", <FFmpeg xfade name>, label]`)
and its name to `transitions` in `server/video/registry.json`, then reference it in a style's `transitions`. Kinds:
`cut`, `xfade` (any FFmpeg xfade name), `ramp` (baked into the outgoing shot).

## Add an AI provider
Subclass `Provider` in `frontend/server/ai/providers.ts` (`generate`, `health`, `listModels`), add its name to
`PROVIDERS` (`server/ai/config.ts`) and return it from `buildProvider()` in `server/ai/index.ts`. Ollama, OpenAI,
Gemini and Claude exist. Every answer is validated with zod and repaired once (`server/ai/types.ts`).

## Add a caption style
`frontend/server/video/render/text.ts`: add a style to `CAPTION_STYLES` and its look to the styles table below it, then
add the name to the `captionStyle` enums in `server/projects/settings.ts` and `server/timeline/ops.ts`, and to
`CAPTION_STYLES` in the frontend forms (`components/organisms/CreateReelForm.tsx`, `editor/AudioCaptionsPanel.tsx`).

## Add a trend preset
`frontend/server/trends/presets.json`. Learned trends (from reference Reels people upload) need no code:
`server/trends/references.ts`. Do not scrape platforms.

## Storage
Files live on the local disk under `STORAGE_PATH` (`server/storage/local.ts`); FFmpeg and OpenCV need local files, so an
S3 / R2 backend would download to a cache before use and upload after a render.
