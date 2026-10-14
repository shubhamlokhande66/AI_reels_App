# Deploying to Cloudflare (Workers + Containers + R2)

The whole app (website, API, FFmpeg, analysis, rendering) runs in **one Cloudflare Container**, built from
`docker/Dockerfile`. A small Worker (`cloudflare/`) sends every request to it. Uploads and Reels are kept in an **R2 bucket**,
mounted inside the container at `/data/storage` (the container's own disk is temporary). The database is your MongoDB
(Atlas).

```
browser ──> Worker (cloudflare/src/index.ts) ──> app container (Next.js + FFmpeg) ──> R2 bucket (mounted) + MongoDB Atlas
                cron, hourly ──> /api/cron (auto-delete, scheduled posts)
```

## 1. What you need
- A Cloudflare account on the **Workers Paid** plan (Containers are not on the free plan; about $5 a month + usage).
- An **R2 bucket** (R2 → Create bucket) and an **R2 API token** with *Object Read & Write* on it (R2 → Manage API tokens):
  you get an *Access Key ID* and a *Secret Access Key*. Your *Account ID* is on the R2 overview page.
- **MongoDB Atlas**: under *Network Access* allow `0.0.0.0/0` (containers do not have a fixed address); use a strong
  database password.

## 2. Settings
Edit `cloudflare/wrangler.jsonc` → `vars`: `R2_BUCKET`, `R2_ACCOUNT_ID`, `PUBLIC_BASE_URL`, `KEEP_ALIVE_URL` (your
address, e.g. `https://reel-maker.<your-subdomain>.workers.dev`), `AI_PROVIDER`.

Then store the secrets once (they are encrypted in Cloudflare and passed to the app; never put them in a file):
```
cd cloudflare
npm install
npx wrangler login
npx wrangler secret put MONGODB_URI
npx wrangler secret put SECRET_KEY            # a long random string (openssl rand -base64 48)
npx wrangler secret put ADMIN_KEY             # another long random string: unlocks /admin
npx wrangler secret put CRON_SECRET           # another long random string: protects /api/cron
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put OPENAI_API_KEY        # and/or GEMINI_API_KEY, SMTP_PASSWORD, RAZORPAY_KEY_SECRET ...
```
Any other setting from `.env.example` can be added the same way (a secret) or under `vars` (not secret).

## 3. Deploy
Building the container image needs Docker. Either:
- **From GitHub (no Docker on your computer):** push the repo, add the repository secrets `CLOUDFLARE_API_TOKEN`
  (a token with *Workers Scripts* and *Containers* edit rights) and `CLOUDFLARE_ACCOUNT_ID`. Every push to `main`
  then deploys by itself (docs-only changes do not); you can also run the **Deploy to Cloudflare** workflow from the
  Actions tab (`.github/workflows/deploy-cloudflare.yml`).
- **From your computer:** install Docker Desktop, then `cd cloudflare && npx wrangler deploy`.

Open the address it prints, create the first account, then `/admin` with `ADMIN_KEY`.

## 4. How it behaves
- **One container** (2 vCPU, 8 GB: `instance_type` in `wrangler.jsonc`), because the job queue lives in it. It **sleeps**
  30 seconds after the last request (`SLEEP_AFTER`; an upload or download in progress counts) and wakes on the next one: the **first request after a sleep takes
  some seconds** (the container starts and mounts R2). While a Reel is being made, the app pings itself so it stays awake.
- **Cost**: you pay for the time the container is awake (CPU, memory, disk) beyond what the Workers Paid plan includes.
  The hourly cron wakes it briefly; make the cron rarer (or remove it) in `wrangler.jsonc` to save more.
  Scheduled posts are published when the app is awake: at the latest by the next cron run.
- **Uploads**: requests pass through the Worker, which accepts bodies up to **100 MB** (Free/Pro plans), so a video can
  be at most **95 MB** (`MAX_VIDEO_SIZE_MB`). Larger files would need direct uploads to R2 (not built yet).
- **Storage**: everything under `STORAGE_PATH` is in R2; render work happens on the container's local disk
  (`SCRATCH_PATH`) and the finished file is copied into R2. A deploy or restart interrupts a running job (it is marked
  failed with a clear message; press Retry).
- **Logs**: Cloudflare dashboard → Workers → reel-maker → Logs (observability is on).
