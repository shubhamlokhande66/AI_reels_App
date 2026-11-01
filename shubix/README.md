# Shubix monorepo (pnpm workspaces)

The whole app, moved from the repository root into separate projects (layout: `../folderStructure.md`).
The current app at the root is untouched and keeps running and deploying until you switch over.

```
FE/web-app      Next.js 16 + Tailwind v4: every page, component, hook and browser engine (Fast Studio) of the website
FE/mobile-app   Expo SDK 57 + NativeWind: the Android/iOS app (replaces the old Capacitor shells, which are not moved)
BE/api          NestJS 11: every endpoint (116) and all server code (accounts, billing, AI, audio, video, storage…)
Shared/core         code both the website and the API run: CMS texts, plans/locks, features, templates, clip analysis core
Shared/types        API types (SessionUser, AuthResponse, error shape)
Shared/validations  Zod schemas + form rules + editor/plan rules (website, phone, API)
Shared/api-client   one fetch client: cookie on the web, Bearer token on the phone
Shared/hooks        the phone's sign-in logic and useText (CMS texts)
Shared/utils        normalizeEmail, maskEmail, fill
Shared/ui-core      design tokens (tokens.json) + brand assets
Shared/ui-mobile    atoms + molecules for the phone (React Native + NativeWind)
infra/              Docker image, Cloudflare Worker, the future CI workflow
docs/               the project docs (moved from /docs)
```

## How the backend is built

- `BE/api/src/routes/<path>/route.ts`: the endpoints, moved unchanged from `app/api/**` (web-standard
  `(Request, { params }) => Response`). `src/routing` serves them from NestJS: the route table is built once at start
  (fixed segments before params, as Next.js did), and requests and responses are **streamed** both ways (uploads and
  videos are never buffered; Range requests work). No body parser: handlers read the stream themselves, as before.
- `BE/api/src/server`: the business logic, moved unchanged from `server/` (`import "server-only"` removed, imports made
  relative). Native Nest modules sit beside it: `auth` (Passport strategy + guard on the same session) and `users`.
- `@shubix/core` is built to CommonJS for the API (`node --conditions=shubix-dist`); the web app compiles its TypeScript.

## One login for web and mobile

Same `users` collection, password hashes and signed session tokens as before, so every account signs in and a session
from the current app also works in the new one (same `SECRET_KEY`). The website uses the httpOnly `reel_session`
cookie (same origin: Next rewrites `/api/*` to BE/api). The phone sends `X-Client: mobile`: a sign-in answer then also
carries the token in its JSON body, kept in SecureStore and sent as `Authorization: Bearer`.

## Run

```
npx pnpm@10.20.0 install
npx pnpm@10.20.0 dev:api      # BE/api on :4000 (reads BE/api/.env, then shubix/.env, then the current app's .env)
npx pnpm@10.20.0 dev:web      # FE/web-app on :3001 (API_URL, default http://localhost:4000)
npx pnpm@10.20.0 dev:mobile   # FE/mobile-app (EXPO_PUBLIC_API_URL)
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 test         # the suites one after another (the UI tests are timing-sensitive)
```

The dev servers also write `logs/api.log`, `logs/web.log`, `logs/mobile.log` (every line, timestamped) and
`logs/<name>.err.log` (errors only); the run before is kept as `<name>.prev.log`. `logs/` is not committed.
Local data: `BE/api/storage` (uploads, saved Reels) and `shubix/.env` (settings) stay on your computer, never in git.

The API reads its data files (AI models, workers, the voice script) from `BE/api/src/server`, so it runs with
`BE/api` as the working directory (every script does). `STORAGE_PATH` is relative to it: point it at the current
app's `storage/` to keep using the same local files.

## Deploy

`infra/docker/Dockerfile` (build from `shubix/`) makes one image with both servers: the API on 127.0.0.1:4000 and the
web server on :3000, which proxies `/api` to it. One container, as before. `infra/cloudflare` is the same Worker
(`cf-assets.mjs` now reads `FE/web-app/public` and the API's model files). `infra/github/deploy-cloudflare.yml` replaces
the root workflow when you switch.

## Left for later

- `FE/web-app/lib/nativeApp.ts` still holds the Capacitor-only download/share path; it does nothing on the website and
  can go once the Expo app has replaced the Capacitor one.
- Moving the server from the MongoDB driver to Prisma, and the endpoints from `src/routes` into Nest controllers module by
  module, can now be done one area at a time behind the same URLs.
