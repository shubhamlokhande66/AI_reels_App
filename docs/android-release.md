# Shubix on Google Play (Android)

The Android app is the Capacitor app in `android/` (docs/capacitor.md): it opens the live Shubix site full screen, with
its own icon, startup screen, microphone (the voiceover) and native save / share of the exported Reel.

## What is set up in the code

- `com.shubix.app`, the Shubix icon and startup screen, target SDK 36 (Play asks for 35 or newer)
- permissions: internet and the microphone (voiceover); https only; no cloud backup of the sign-in session
- the version in `android/app/version.properties` (`--bump` raises it for each upload)
- release signing from `android/keystore.properties` (never in git)
- `npm run android:release`: checks the address and the key, syncs, builds the signed `.aab`

## 1. The upload key (once, keep it safe)

Google Play signs the app for users with its own key (Play App Signing); you sign each upload with an **upload key**.
Make it once, in `android/` (JDK 21: Android Studio's, or `C:\Program Files\Microsoft\jdk-21…\bin\keytool`):

```
keytool -genkeypair -v -keystore shubix-upload.jks -alias shubix -keyalg RSA -keysize 2048 -validity 10000
```

Then create `android/keystore.properties` (it and the `.jks` are git-ignored):

```
storeFile=shubix-upload.jks
storePassword=…the password you chose…
keyAlias=shubix
keyPassword=…the key's password…
```

**Back up the `.jks` and both passwords** somewhere safe (a password manager). Losing them means asking Google to
reset the upload key.

## 2. Build the bundle

The app must open the **live** site (https, not localhost or a tunnel):

```
PowerShell:  $env:CAP_SERVER_URL="https://your-live-site"; npm run android:release -- --bump
cmd:         set CAP_SERVER_URL=https://your-live-site && npm run android:release -- --bump
```

The first upload can skip `--bump` (version 1.0.0, code 1). The bundle is
`android/app/build/outputs/bundle/release/app-release.aab`.

## 3. Google Play Console

1. A developer account (one-time fee) at play.google.com/console; a new **personal** account must run a closed test
   with at least 12 testers for 14 days before it can publish to everyone.
2. **Create app**: name Shubix, app (not game), free or paid.
3. **Testing → Internal testing → Create release**: upload the `.aab` (accept Play App Signing), add testers, roll out.
4. **App content** (all required before review):
   - Privacy policy: `https://your-live-site/privacy`
   - App access: a test login for the reviewers (sign-in is needed to use the studio)
   - Ads: no ads (unless added)
   - Content rating questionnaire
   - Target audience: 13+ / 18+ as the terms say
   - **Data safety**: account (email), purchases, user content (videos, audio, photos are processed on the phone; say what
     reaches the server: sign-in, AI requests, saved Reels if any), microphone audio for the voiceover
   - **Account deletion**: in the app (Account → delete) and the web link `https://your-live-site/account`
5. **Store listing**: short and full description, the 512×512 icon (`public/icon-512.png`), a 1024×500 feature graphic,
   at least 2 phone screenshots (portrait Reels editor, Create flow, My Reels).
6. Promote internal → closed → production when the testers are happy.

## Before the first public release: payments (must decide)

Google Play requires **Google Play Billing** for digital goods bought inside an app (plans, credits). The app opens the
website, so its Razorpay checkout would be inside the Play app, which Play does not allow for digital goods (India allows
an alternative billing system only through Play's User Choice Billing enrolment, with Google's service fee).
Choose one before going public:

- add Google Play Billing for the plans and credits in the Android app, or
- enrol in User Choice Billing (India), keeping Razorpay as the alternative, or
- hide buying in the Android app (the pricing page shows plans but buying happens on the website) — check this against
  Play's current payments policy before relying on it.

Internal testing can start without this.
