# Shubix Android app

The Expo + React Native app (`in.shubix.reelmaker`): the website's phone view, built natively, with the same account,
plan and credits. Plans are bought only on the website (`docs/play-store/README.md`).

- Screens: Expo Router (`app/`), NativeWind classes, the components of `@shubix/ui-mobile`, texts from the CMS (`useText`).
- The studio: the website's own engine runs in a hidden page (`lib/engine.tsx`, the site's `/engine`): it reads the song and
  the clips, makes the Reel and exports it. `modules/shubix-video` gives it the phone's files and the native export.
- Ads: AdMob banners on the plans with ads, after Google's consent form where the law asks for it (`lib/ads.ts`). The app id
  comes from `ADMOB_ANDROID_APP_ID` at build time (Google's test ids without it); the ad units from Admin → Settings → Ads.
- Errors on the phone reach Admin → Errors (`lib/errors.ts`).
- Icons: `assets/icon.png` and `assets/adaptive-icon.png` come from `FE/web-app/scripts/brand-assets.mjs`.

## Run it

| How | What works | Command |
|---|---|---|
| Expo Go | screens and sign-in only: no studio, export or ads | `npx pnpm@10.20.0 dev:mobile` (from `shubix/`) |
| Development build on a phone (USB) | everything, with live reload | `npx expo run:android` (here) |
| Test APK | everything, like the store app | GitHub → Actions → **Android test APK** → Run workflow; download it from the run's Artifacts |
| Play Store | | EAS: `docs/android-release.md` |

The API address is `EXPO_PUBLIC_API_URL` (`.env`; `https://api.shubix.in` for real use; `http://10.0.2.2:4000` is the
emulator's view of this computer). `EXPO_PUBLIC_SITE_URL` is the website the hidden studio opens.

Release builds keep R8 off (`app.config.ts`): it removed a class WorkManager needs and the app closed at start.

A crash on a phone: connect it with USB debugging on, then `adb logcat -b crash`.
