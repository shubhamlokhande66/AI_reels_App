# Shubix as a phone app (Capacitor)

The same Shubix web app, packaged as an Android and iPhone app (`android/`, `ios/`, `capacitor.config.ts`). The app opens
Shubix's server inside its own full-screen window: sign-in, the AI, My Reels all work as on the website.

## The server address

The app needs an **https** address the phone can reach, given as `CAP_SERVER_URL` when syncing:

- the live site, once deployed (docs/deploy-cloudflare.md), or
- for testing, a tunnel to this computer: `cloudflared tunnel --url http://localhost:3000` (prints `https://….trycloudflare.com`;
  it changes on every start, so sync again).

```
set CAP_SERVER_URL=https://xxxx.trycloudflare.com   (PowerShell: $env:CAP_SERVER_URL="https://…")
npx cap sync
```

When the address cannot be reached, the app shows `capacitor/www/index.html` ("Shubix can't connect").

## Android (Windows, macOS, Linux)

Needs Java 21 and the Android SDK (Android Studio installs both). Then:

```
npm run cap:android        → android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a phone over USB (`adb install -r app-debug.apk`) or send the file to the phone and open it
(allow "Install unknown apps" once).

## iPhone (a Mac only)

Needs Xcode. `npm run cap:ios` opens the project in Xcode: choose your iPhone and press Run (a free Apple ID can run it
on your own phone for 7 days; TestFlight and the App Store need the Apple Developer Program).

## Still to do for the stores

- saving the exported Reel to Photos / Gallery and the share sheet through native plugins (the web download and
  share are limited inside an app)
- app icon and splash screen from `public/icon-512.png` (`npx @capacitor/assets generate`)
- iOS payments: Apple In-App Purchase instead of Razorpay (App Store rule 3.1.1)
