# Deploying to a server (VPS)

One machine runs the website, the Python API with its render queue, and Caddy (HTTPS) with Docker. The database is
MongoDB Atlas (the free 512 MB cluster is enough: only small records are stored; videos stay on the server disk).

## 1. The server
- Ubuntu 22.04/24.04, **4 GB RAM minimum** (8 GB+ recommended: rendering and speech recognition use memory), 2+ CPU
  cores, 50 GB+ disk (uploads and renders). A GPU is not needed.
- Install Docker: `curl -fsSL https://get.docker.com | sh`
- Point your domain (DNS **A** record) at the server's IP. Open ports **80** and **443**.

## 2. Configure
```
git clone <your repo> reels && cd reels
cp .env.production.example .env.production
nano .env.production        # DOMAIN, MONGODB_URI, SECRET_KEY, ADMIN_KEY, GEMINI_API_KEY, MAX_CONCURRENT_JOBS
```
**MongoDB Atlas:** create a free cluster, a database user, and under *Network Access* allow this server's IP. Copy the
connection string (*Connect → Drivers*) into `MONGODB_URI`. All users share one database; each record carries its
owner, so users only ever see their own projects.

`SECRET_KEY` and `ADMIN_KEY`: long random strings (`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`).

## 3. Start
```
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
Open `https://<DOMAIN>`: create the first account. Then open `https://<DOMAIN>/admin` and enter `ADMIN_KEY` to
unlock AI settings in that browser.

## 4. Operate
- Update: `git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
- Logs: `docker compose -f docker-compose.prod.yml logs -f backend`
- Backups: Atlas free clusters have no automatic backups; export when needed with
  `mongodump --uri "$MONGODB_URI"`. Uploads and Reels are on the `storage-data` volume (and are deleted automatically
  when auto-delete is on).
- Auto-delete: on the Admin page set how long uploaded clips and whole projects are kept (defaults: 2 hours / 1 day).
- Renders queue up: at most `MAX_CONCURRENT_JOBS` run at once; a job interrupted by a restart is marked failed with
  a clear message (press Retry).

## What runs where
| Part | Reached at | Notes |
|---|---|---|
| Website (Next.js) | `https://DOMAIN/` | |
| API (Python) | `https://DOMAIN/api/...` | no auto-reload in production; one process (it holds the job queue) |
| MongoDB Atlas | `MONGODB_URI` | one database; every record tagged with its owner |
| Caddy | ports 80/443 | automatic HTTPS certificates |

## Connecting the platforms (optional)
Fill the keys in `.env.production`, then restart (`... up -d`). The **Post it** panel under a finished Reel shows each
platform as Connected / Not connected; until connected, users download or share and post themselves.

| Platform | What you need | Settings |
|---|---|---|
| Instagram Reels | A professional (Business/Creator) account linked to a Facebook Page, a Meta app with `instagram_content_publish` | `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN` (long-lived) |
| TikTok | An approved app with the Content Posting API (direct post), your domain verified for URL pull | `TIKTOK_ACCESS_TOKEN` |
| YouTube Shorts | A Google Cloud OAuth client and a refresh token with `youtube.upload` | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` |

`PUBLIC_BASE_URL` (your https address) and `SECRET_KEY` are needed for Instagram and TikTok: they download the video
from a signed link that expires after 2 hours. Scheduled posts are sent by the server within 30 seconds of their time.
The connected accounts are the studio's (one set of keys for the server).

## Live trends (optional)
`TREND_FEED_URL` (+ `TREND_FEED_KEY`): a licensed / official trend-data feed returning a JSON list of presets
(`id, trendName, recommendedDuration, cutFrequency: fast|medium|slow, transitionStyle: smooth|punchy|minimal,
captionStyle, description`). It is read once an hour, shown above the built-in trends, and if it is down the last good
list keeps working. Nothing is scraped.
