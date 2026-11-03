# Website on Vercel, API on Cloudflare

```
browser / phone app ──> Vercel (FE/web-app, Next.js) ──/api/*──> Cloudflare Worker ──> API container (BE/api, FFmpeg, AI models)
                                                                                         └─> R2 bucket (mounted) + MongoDB Atlas
```

The website calls `/api` on its own address; Vercel passes it on to the API (`next.config.ts` rewrites, `API_URL`), so
the sign-in cookie stays the website's own. The API keeps the parts Vercel cannot run (FFmpeg, the AI models, a lasting
disk: the R2 bucket mounted by `infra/docker/start.sh`).

## 1. The API on Cloudflare (first: the website needs its address)

Same as `docs/deploy-cloudflare.md` (Workers Paid plan, R2 bucket, Atlas allowing `0.0.0.0/0`, the secrets), with these
settings in `infra/cloudflare/wrangler.jsonc` → `vars`:

| Setting | Value |
|---|---|
| `CONTAINER_ROLE` | `api`: the container runs the API alone (the Worker sends requests to its port 4000) |
| `WEB_ORIGINS` | the website's address, e.g. `https://your-project.vercel.app` (and your own domain, comma-separated) |
| `PUBLIC_BASE_URL` | the website's address: links in emails open the website |

Deploy: push to `main` (the GitHub workflow `.github/workflows/deploy-cloudflare.yml`) or run it from the Actions tab;
from a computer with Docker: `cd infra/cloudflare && npm install && npm run deploy`. Note the address it prints
(`https://shubix-api.<subdomain>.workers.dev`); check `https://…workers.dev/api/health`.

## 2. The website on Vercel

1. vercel.com → **Add New… → Project** → import the repository.
2. **Root Directory**: `shubix/FE/web-app` (keep "Include files outside the root directory" on: the shared packages are
   in `shubix/Shared`). Framework, install and build commands come from `FE/web-app/vercel.json` (region Mumbai).
3. **Environment variables**:

| Name | Value |
|---|---|
| `API_URL` | the API's address from step 1, e.g. `https://shubix-api.<subdomain>.workers.dev` (no `/` at the end) |
| `PUBLIC_BASE_URL` | the website's own address (page previews when a link is shared) |

Only these (`FE/web-app/.env.example`). The API's settings and secrets (`BE/api/.env.example`) go to Cloudflare only.

4. **Deploy**. Then put the Vercel address into `WEB_ORIGINS` and `PUBLIC_BASE_URL` (step 1) and deploy the API again.

The website itself holds no secrets: the database, payments, email and AI keys stay with the API.

## 3. The phone app

`FE/mobile-app` (EAS → Environment variables, then build again):

| Name | Value |
|---|---|
| `EXPO_PUBLIC_API_URL` | the API's address (Cloudflare) |
| `EXPO_PUBLIC_SITE_URL` | the website's address (Vercel): the phone's hidden studio opens `/engine` there |

## 4. Your domain

Vercel → Project → Settings → Domains: add it (e.g. `shubix.in`), set the DNS record shown. Add it to `WEB_ORIGINS`
and `PUBLIC_BASE_URL`, and to the R2 bucket's CORS (Settings → CORS policy → AllowedOrigins: methods
`GET, PUT, POST, HEAD`, `ExposeHeaders: ["ETag"]`): clips upload from the browser straight into R2.

## Limits to know

- Vercel limits request bodies (4.5 MB on its functions). Big uploads (clips, saved Reels) go from the browser straight
  to R2 (presigned, needs the R2 settings), so they never pass through Vercel. Check one upload after the first deploy.
- `API_URL` is read when the website is built: after changing it, deploy the website again.
- Cost policy: `SLEEP_AFTER=30s`. No cron, scheduled warm-up or keep-alive request is used to keep the API container
  running. When no real API traffic arrives for 30 seconds, the container is allowed to stop; container images being
  prepared do not mean a running instance is being kept alive.
- The app's periodic presence ping is answered by the Worker while the container is stopped, so an open browser tab
  alone does not wake or bill the API container. A real API request automatically starts it and waits for port 4000
  to become ready (up to 4 minutes per start attempt). A transient start/readiness failure triggers one clean restart
  and a second automatic start attempt; no manual redeploy is needed for that recoverable failure.
- For failures after proxying begins, the Worker resets the stale container. It retries safe `GET`, `HEAD` and
  `OPTIONS` requests once. It never replays `POST`, `PUT`, `PATCH` or `DELETE`, because the API may already have
  processed them; those receive `503 API_CONTAINER_RECOVERING` with `Retry-After: 2` so the client can retry safely.
- After every deploy, check `https://api.shubix.in/api/health` (`{"status":"ok"}`) and Cloudflare Worker logs. If the
  API remains unavailable, inspect the container startup/R2 mount logs and MongoDB connectivity before redeploying.
