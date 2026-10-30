# Shubix on Google Play: the App content answers

The phone app is the Expo app `FE/mobile-app` (package `com.shubix.reels`). This page has what Play Console → **App
content** asks, worked out from the code (2026-10-30). Check it again when the app starts collecting something new.
Replace `https://SITE` with the live website.

## Links

| Play Console field | Value |
|---|---|
| Privacy policy | `https://SITE/privacy` |
| Delete account (web link) | `https://SITE/delete-account`: public, no sign-in needed. Says how to delete in the app (My account → Delete account) and without it (email), and what is deleted and kept. Its text: Admin → CMS → Legal pages → Delete your account |
| Delete account (in the app) | Yes: My account → Delete account |

## Photo and video permissions (no declaration needed)

The app asks for **no** photo, video or audio read permission, so Play's *Photo and video permissions* declaration
does not apply:

- clips and photos come from Android's **photo picker** (`expo-image-picker`), songs from the **file picker**
  (`expo-document-picker`): the person picks, no permission is needed;
- finished Reels are **saved** to the gallery write-only (`MediaLibrary.requestPermissionsAsync(true)`): no read
  permission on Android 13+, `WRITE_EXTERNAL_STORAGE` only on Android 12 and older;
- `app.json` → `android.blockedPermissions` removes READ_MEDIA_IMAGES / VIDEO / AUDIO / VISUAL_USER_SELECTED,
  ACCESS_MEDIA_LOCATION, CAMERA, RECORD_AUDIO and SYSTEM_ALERT_WINDOW, even when a library asks for them.

Check after each build: `aapt dump permissions app.apk` must show none of those.

Expected in the app: INTERNET, POST_NOTIFICATIONS ("Reel exported"), and AdMob's
`com.google.android.gms.permission.AD_ID`; the libraries may add small ones (WAKE_LOCK, VIBRATE). Any other one
needs a reason here before upload.

## Ads

**Yes, the app contains ads**: AdMob banners on the Free plan (home and My account). Advertising ID: **used, for
advertising**.

- The AdMob **app ID** is set at build time: `ADMOB_ANDROID_APP_ID` (EAS → Environment variables). Without it,
  `app.config.ts` builds in Google's sample ID, which shows test ads only. Set it before the production build.
- The banner **ad units** are set at run time: Admin → Settings → Ads.

## Data safety

Data is encrypted in transit (https). People can ask for deletion (above).

| Data type | Collected | Shared | Why | Optional |
|---|---|---|---|---|
| Personal info → Email address, Name | Yes | No | Account management | No (sign-in) |
| Financial info → Purchase history | Yes | No | App functionality (plans, credits, receipts) | Yes (only when buying) |
| Financial info → Payment info | No: Razorpay takes the card/UPI on its own page; the app never sees it | | | |
| Photos and videos | Yes, when Shubix AI is used: small frames of the clips go to the server to choose the cuts; also the Reels saved to My Reels | No | App functionality | Yes |
| Audio → Music files / other audio | Yes, when captions or Shubix AI are used: the song's audio for the words | No | App functionality | Yes |
| App activity → Other user-generated content | Yes: texts, templates, brands, saved styles | No | App functionality | Yes |
| App info and performance → Crash logs | No (no crash reporting yet) | | | |
| Device or other IDs → Advertising ID | Yes, by AdMob | Yes, with Google (AdMob) | Advertising | No on the Free plan |

The song analysis, the beat check, the clip reading and the export run **on the phone**: the clips themselves are
not uploaded to make a Reel. Mark "processed ephemerally" only for data the server does not store; Reels saved to
My Reels are stored (for the days shown in the app).

## Other answers

- **App access**: sign-in is needed. Give the reviewers a test account (email + password) with credits.
- **Target audience**: 18+, or 13+ if the Terms say so.
- **Content rating**: no violence or other mature content; people can share content they make (the questionnaire's
  "user-generated content" answer: yes).
- **News app**: no. **Government app**: no. **Financial features**: no.
- **Payments**: Google Play asks for Play Billing for plans and credits bought inside an app. Decide before the
  public release: Play Billing, User Choice Billing (India), or buying only on the website.

## Store listing

`icon-512.png` and `feature-graphic-1024x500.png` are in this folder. Still needed: at least 2 phone screenshots
(Create, the editor, My Reels), the short and full descriptions.
