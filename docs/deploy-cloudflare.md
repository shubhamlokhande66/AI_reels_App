# Deploying to Cloudflare (Workers + Containers + R2)

The whole app (website, API, FFmpeg) runs in **one Cloudflare Container**, built from
`docker/Dockerfile`. A small Worker (`cloudflare/`) sends every request to it. Uploads and Reels are kept in an **R2 bucket**,
mounted inside the container at `/data/storage` (the container's own disk is temporary). The database is your MongoDB
(Atlas).

```
browser ──> Worker (cloudflare/src/index.ts) ──> app container (Next.js + FFmpeg) ──> R2 bucket (mounted) + MongoDB Atlas
```

## 1. What you need
- A Cloudflare account on the **Workers Paid** plan (Containers are not on the free plan; about $5 a month + usage).
- An **R2 bucket** (R2 → Create bucket) and an **R2 API token** with *Object Read & Write* on it (R2 → Manage API tokens):
  you get an *Access Key ID* and a *Secret Access Key*. Your *Account ID* is on the R2 overview page.
- **MongoDB Atlas**: under *Network Access* allow `0.0.0.0/0` (containers do not have a fixed address); use a strong
  database password.

## 2. Settings
Edit `cloudflare/wrangler.jsonc` → `vars`: `R2_BUCKET`, `R2_ACCOUNT_ID`, `PUBLIC_BASE_URL` (your
address, e.g. `https://reel-maker.<your-subdomain>.workers.dev`), `AI_PROVIDER`.

Then store the secrets once (they are encrypted in Cloudflare and passed to the app; never put them in a file):
```
cd cloudflare
npm install
npx wrangler login
npx wrangler secret put MONGODB_URI
npx wrangler secret put SECRET_KEY            # a long random string (openssl rand -base64 48)
npx wrangler secret put ADMIN_KEY             # another long random string: unlocks /admin
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
- **From your computer:** install Docker Desktop, run `npm install` once in the repo root, then `cd cloudflare && npm run deploy`
  (it first makes the static assets, see below; a plain `npx wrangler deploy` works too, without them).

Open the address it prints, create the first account, then `/admin` with `ADMIN_KEY`.

## 4. How it behaves
- **Reels are made on the phone**: every Music, Talking and Photo Reel and Story Maker Reel is edited and exported in
  the browser. The container serves the site and the API (accounts, credits, payments, the AI director, captions,
  Brands, Voice profiles, My trends) and keeps the Reels people save to **My Reels**.
- **One container** (`instance_type` in `wrangler.jsonc`). It **sleeps** 30 seconds after the last request
  (`SLEEP_AFTER`; an upload or download in progress counts) and wakes on the next one: the **first request after a
  sleep takes some seconds** (the container starts and mounts R2).
- **Open tabs do not wake it**: an open tab says "still here" every 5 minutes (the admin's "online now"); while the
  container sleeps, the Worker answers that itself (`cloudflare/src/index.ts`), so a tab left open costs nothing.
- **One container**: every request goes to the one named `main`. `max_instances` above 1 would not be used by itself;
  sharing the load (random containers) would keep two awake at quiet times and double the cost. Only worth it when one
  `basic` container is no longer fast enough (then first try `standard-1`).
- **Static assets (free)**: the files that never change are not served by the container. Before each deploy
  `scripts/cf-assets.mjs` copies `public/` (logo, icons, the AI engine in `vendor/ort`, …) and the AI models Fast Studio
  downloads (`/api/studio/model/*`, ~25 MB for a new visitor) into `cloudflare/assets/`, with their headers (`_headers`).
  Cloudflare serves them itself from the nearest data centre: free, unlimited, and the container is not woken. Pages,
  the API and Next's own JS still come from the container. A file over 25 MiB, or one missing, is served by the app as
  before.
- **Cost**: you pay for the time the container is awake (CPU, memory, disk) beyond what the Workers Paid plan includes.
  Memory is billed for the whole size of the instance while it is awake, used or not, so keep it small: Reels are made
  on the phone, the server only answers the API. `basic` (¼ vCPU, 1 GiB, 4 GB disk) is the default: measured, the
  Next.js server stays at ~165 MB (also after 500 page loads at once), FFmpeg cutting audio for captions ~47 MB, so with
  the R2 mount and the database the app needs ~250-350 MB. Use `standard-1` (½ vCPU, 4 GiB) if the logs show "out of
  memory" (My trends / References analyse videos on the server) or the app gets slow with many people at once; `lite`
  (256 MiB) is too small. The app asks the server rarely (presence every 5 minutes while a
  tab is visible, credits when the tab comes back), so the container can sleep; a timer that called it every 30 s kept it
  awake all day.
- **My Reels uploads**: a saved Reel goes **from the browser straight into R2** in parallel parts; it never passes
  through the Worker or the container, so the 100 MB request limit does not apply. Trend videos and brand logos go
  through the Worker (at most **95 MB**).
- **R2 setup for My Reels (once)**: R2 → your bucket → Settings →
  - **CORS policy** (the browser may PUT parts, and must see each part's ETag):
    ```json
    [{ "AllowedOrigins": ["https://reel-maker.<your-subdomain>.workers.dev"], "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
    ```
    (add your own domain too if the app has one). Without `ExposeHeaders: ETag` an upload stops with a clear message.
  - **Object lifecycle rule**: *Abort incomplete multipart uploads* after 1 day (parts of uploads someone abandoned).
- **Storage**: everything under `STORAGE_PATH` is in R2.
- **Logs**: Cloudflare dashboard → Workers → reel-maker → Logs (observability is on).
