# Deploy on Vercel

The whole app (pages and API) runs on Vercel as a normal Next.js project. Reels are made on the phone, so the server
only answers small API calls; Vercel runs it on demand (no server to keep awake).

## 1. Connect the repository
1. vercel.com → **Add New… → Project** → import `shubhamlokhande66/AI_reels_App`.
2. Framework: **Next.js** (found by itself). Root directory: the repo root. Build and install commands come from
   `vercel.json` (the AI runtime's GPU download is skipped; the region is Mumbai, `bom1`, near the users).
3. Add the environment variables below, then **Deploy**. Every push to `main` deploys again; every PR gets a preview link.

## 2. Environment variables (Project → Settings → Environment Variables)
| Name | What |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | the MongoDB Atlas database (Atlas → Network Access: allow `0.0.0.0/0`, Vercel has no fixed IP) |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **required on Vercel**: saved Reels and clips go from the phone straight into R2 (Vercel accepts at most 4.5 MB per request, so files never pass through it) |
| `AUTH_ENABLED`, `ADMIN_EMAILS`, `ADMIN_KEY`, `BILLING_ENABLED`, Razorpay keys, AI keys, … | the same values as on Cloudflare (`.env.example` lists all) |

Leave `STORAGE_PATH` / `STORAGE_MOUNTED` unset: on Vercel the server's disk is temporary (`/tmp`).

## 3. R2 CORS
The browser uploads to R2 directly, so the bucket must allow the Vercel address: R2 → bucket → Settings → CORS policy,
add `https://<project>.vercel.app` (and your own domain) to `AllowedOrigins` with methods `GET, PUT, POST, HEAD` and
`ExposeHeaders: ["ETag"]`.

## 4. Your domain
Project → Settings → Domains → add it, and set the DNS record Vercel shows.

## How it differs from Cloudflare
- **Small files kept in the database**: the AI settings and brand logos lived on the server's disk. On Vercel each server
  copy has only a temporary disk, so a copy is kept in MongoDB (`app_files`) and put back when a server starts
  (`server/storage/dbFiles.ts`). Any other host can turn this on with `FILES_IN_DB=on`.
- **FFmpeg** (captions, reference Reels) comes from the `ffmpeg-static` / `ffprobe-static` packages when the system has none.
- **Model files** (`/api/studio/model/*`) are cached by Vercel's CDN for a year, so the server is not called again for them.
- Static files (`public/`, `/_next/static`) are served by Vercel's CDN.
- An API call may run up to 60 s (`vercel.json`).

## Cost
Hobby (free) is for personal, non-commercial use only; a paid app needs the **Pro** plan (per team member, with a monthly
usage allowance). Current prices: https://vercel.com/pricing. The API here is light (Reels are made on the phone), so
function time stays small; R2 (storage) and MongoDB are billed by Cloudflare and Atlas as before.
