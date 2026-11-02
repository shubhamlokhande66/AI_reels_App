```
.github/workflows/
├── shubix-ci.yml               # checks for every PR into main: types, API + web tests, web build, Android debug build
├── deploy-cloudflare.yml       # main → the API on Cloudflare (the website deploys itself on Vercel)
└── android-apk.yml             # by hand: a test APK to install on a phone (Actions → Android test APK → Run workflow)

shubix/                         # the monorepo (pnpm workspaces)
├── FE/
│   ├── web-app/                # Next.js 16 + Tailwind v4: shubix.in, on Vercel
│   │   ├── app/                # pages (App Router), icons, robots.ts, sitemap.ts
│   │   ├── components/         # atoms, molecules, organisms, templates; studio/ = Fast Studio (the editor)
│   │   ├── lib/  hooks/        # API client, drafts, background work, error reports
│   │   ├── public/             # brand logo, web app icons, AI models (vendor/)
│   │   ├── scripts/            # brand-assets.mjs (every logo and icon), studio test scripts
│   │   └── tests/              # Vitest
│   └── mobile-app/             # Expo SDK 58 + NativeWind: the Android app (in.shubix.reelmaker)
│       ├── app/                # screens (Expo Router)
│       ├── components/         # native UI
│       ├── lib/                # API, drafts, ads (AdMob + consent), error reports, the hidden studio (engine)
│       ├── modules/            # shubix-video: native export and the studio's local file server
│       ├── assets/             # app icon (from scripts/brand-assets.mjs)
│       └── app.json, app.config.ts, eas.json
├── BE/api/                     # NestJS 11 + Node: the API, on a Cloudflare container (api.shubix.in)
│   ├── src/routes/             # every endpoint: routes/api/<path>/route.ts
│   ├── src/server/             # the logic: accounts, billing (Razorpay), credits, ads, AI, studio, email, storage
│   └── test/                   # Vitest (an in-memory MongoDB)
├── Shared/                     # packages both sides use
│   ├── core/                   # CMS texts (lib/texts.ts), plans and locks, features, templates, clip analysis
│   ├── validations/  types/    # Zod schemas and API types
│   ├── api-client/  hooks/     # one fetch client (cookie on the web, token on the phone), useText
│   ├── ui-core/                # design tokens + the logo originals (assets/)
│   ├── ui-web/  ui-mobile/     # shared web and phone components
│   └── utils/  video-engine/
├── infra/
│   ├── cloudflare/             # the API's Worker + container (wrangler.jsonc)
│   └── docker/                 # the container images
└── docs/                       # deploy, Android release, Play Store, Fast Studio, roadmap
```
