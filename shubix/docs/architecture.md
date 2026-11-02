# Architecture

```
browser ──> shubix.in (Vercel, FE/web-app) ──/api/*──> api.shubix.in (Cloudflare Worker ──> container: BE/api)
phone app (FE/mobile-app) ─────────────────────────────> api.shubix.in                     └─> MongoDB Atlas + R2
```

## Where the work happens

- **The Reel is made on the person's device.** Fast Studio (`FE/web-app/components/studio`) reads the song (beats, drops,
  parts), reads the clips (motion, faces, best moments), plans the cuts on the beat, plays the preview and exports the
  video (WebCodecs, else the browser's recorder). The phone app runs the same engine in a hidden page (`/engine`).
- **The API** (`BE/api`) keeps accounts and sessions, plans and credits (Razorpay on the website), the CMS texts,
  templates, My Reels (R2), email, ads settings, error reports, and the AI features (Shubix AI plans the edit from small
  preview frames; captions and narration). Heavy clips the browser cannot decode are converted there (FFmpeg).
- **Shared code** (`Shared/core`) is what both run: texts, plans and locks, features, templates, clip analysis.

## Data

MongoDB collections such as `users`, `wallets`, `projects`, `client_errors`, `support_messages`, `broadcasts`,
`app_settings`. Files (uploads, saved Reels) in the R2 bucket, mounted into the API container. Drafts and smooth clip copies
stay on the device.

The first version of Shubix was a Python server that edited and rendered on the server; it is described in
`docs/legacy-README.md` and is no longer used.
