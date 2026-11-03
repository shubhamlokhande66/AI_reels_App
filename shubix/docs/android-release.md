# Shubix on Google Play (Android)

The Android app is the Expo app `FE/mobile-app` (package `in.shubix.reelmaker`, target SDK 36). The Play Console answers
are in `docs/play-store/README.md`.

## 1. Before the first build

- EAS → Environment variables (production): `ADMOB_ANDROID_APP_ID` (without it the build shows test ads only) and
  `EXPO_PUBLIC_API_URL=https://api.shubix.in`.
- Admin → Settings → Ads: the AdMob banner unit. AdMob → Privacy & messaging: publish the consent message.
- Raise `android.versionCode` in `FE/mobile-app/app.json` for each upload.

## 2. Build and upload

Run in `FE/mobile-app`:

```
npx eas-cli build --platform android --profile production
```

The first build creates the upload key and EAS keeps it (never use `android/app/debug.keystore`, which is for
development only). Download a copy from EAS → Credentials and keep it safe. The result is a signed `.aab`.

### Or on this computer (no EAS)

The upload key is `FE/mobile-app/keys/shubix-upload.jks` (made 2026-11-03 after the first one was lost; a copy is in
`C:\Users\antre\shubix-keys`; keep another copy and its password off this computer). Its settings are in `FE/mobile-app/keystore.properties` (never in git):

```
storeFile=C:/Shubham/ai-reel-maker/shubix/FE/mobile-app/keys/shubix-upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

Back up the key and the .env files (a locked zip on the Desktop, for Google Drive): `npm run backup:keys`.

Then, at the repo root: `npm run android:aab` (or `pnpm aab` in `FE/mobile-app`). It checks the key, makes `android/`
again from the config (AdMob id, version, the key: `plugins/with-upload-key.js`) and prints where the `.aab` is
(`FE/mobile-app/android/app/build/outputs/bundle/release/app-release.aab`). Raise `versionCode` first.

## 3. Google Play Console

1. A new **personal** account must run a closed test with at least 12 testers for 14 days before it can publish to everyone.
2. Create the app, accept Play App Signing, and upload the `.aab` to Internal testing.
3. Fill in App content and the store listing from `docs/play-store/README.md`, with a test account for the reviewers.
4. Promote internal → closed → production.

## Payments

Plans and credits are bought only on the website: the app has no prices, no buying and no link to the pricing page, so
Play Billing is not needed. To sell inside the app, add Google Play Billing (or enrol in User Choice Billing for India).
