# Shubix on Google Play: the App content answers

The phone app is the Expo app `FE/mobile-app` (package `in.shubix.reelmaker`). This page has what Play Console → **App
content** asks, worked out from the code (2026-10-30). Check it again when the app starts collecting something new.
`https://SITE` is `https://shubix.in`.

## Links

| Play Console field | Value |
|---|---|
| Privacy policy | `https://SITE/privacy` |
| Delete account (web link) | `https://SITE/delete-account`: public, no sign-in needed. Says how to delete in the app (My account → Delete account) and without it (email), and what is deleted and kept. Its text: Admin → CMS → Legal pages → Delete your account |
| Delete account (in the app) | Yes: My account → Delete account |

## Photo and video permissions (declaration needed)

The app asks for **READ_MEDIA_VIDEO and READ_MEDIA_IMAGES** (and READ_MEDIA_VISUAL_USER_SELECTED: Android 14's "some
photos"): its own gallery (`components/organisms/Gallery.tsx`) numbers clips in the order they are tapped, which "In my
order" needs and which Android's photo picker cannot promise (many phones give picked items newest first).

Play Console → App content → **Photo and video permissions**: core functionality. Suggested text:

> Shubix is a video editor: people choose many clips from their gallery, in the order they should play, to make one
> Reel. The app shows the gallery so each clip is numbered in the order tapped; the system photo picker does not keep
> that order. Media is read only when the person opens Add clips.

Still blocked (`app.json` → `android.blockedPermissions`): READ_MEDIA_AUDIO, ACCESS_MEDIA_LOCATION, CAMERA,
RECORD_AUDIO, SYSTEM_ALERT_WINDOW. Songs come from the file picker; finished Reels are saved without extra permissions.
Without the gallery permission the app falls back to the system picker (order may then need the tap-to-move fix).

## Foreground service (declaration needed)

A Reel goes on being made with the screen off or in another app (`ShubixWorkService.kt`): `mediaProcessing` on Android 15+, `dataSync` before. Play Console → App content → **Foreground service permissions**: asks what it does and a short video of it. Suggested text:

> While a person's Reel is being made or exported they can leave the app. The service keeps that work running, shows a notification for as long as it runs, and ends when the Reel is done. It starts only after the person chooses clips or presses Export.

## Ads

**Yes, the app contains ads**: AdMob banners on the Free plan (home and My account). Advertising ID: **used, for
advertising**.

- The AdMob **app ID** is set at build time: `ADMOB_ANDROID_APP_ID` (EAS → Environment variables). Without it,
  `app.config.ts` builds in Google's sample ID, which shows test ads only. Set it before the production build.
- The banner **ad units** are set at run time: Admin → Settings → Ads.
- **Consent**: the app shows Google's consent form before the first ad (`lib/ads.ts`) and My account → Ad privacy choices where it is required. Publish the message in AdMob → Privacy & messaging, or people in the EU, UK and Switzerland get no ads.
- **AI content**: a Report link under Ask Shubix's answers opens Contact.

## Data safety

Data is encrypted in transit (https). People can ask for deletion (above).

| Data type | Collected | Shared | Why | Optional |
|---|---|---|---|---|
| Personal info → Email address, Name | Yes | No | Account management | No (sign-in) |
| Financial info → Purchase history | Yes | No | App functionality (plans, credits, receipts) | Yes (only when buying) |
| Financial info → Payment info | No: Razorpay takes the card/UPI on its own page; the app never sees it | | | |
| Photos and videos | Yes, when Shubix AI is used: small frames of the clips go to the server to choose the cuts; also the Reels saved to My Reels | No | App functionality | Yes |
| Audio → Music files / other audio | Yes, when captions or Shubix AI are used: the song's audio for the words, and a short sample so Shubix AI can match the edit to the song | No | App functionality | Yes |
| App activity → Other user-generated content | Yes: texts, templates, brands, saved styles | No | App functionality | Yes |
| App info and performance → Crash logs | Yes: the error message and where it happened, kept 30 days, not linked to an account (`lib/errors.ts`) | No | Analytics (fixing errors) | No |
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
- **Payments**: plans and credits are bought only on the website. The app has no prices, no way to buy and no way to
  the website's pricing page: keep it so, or Google Play asks for Play Billing. It only shows what the account has.

## Buying a plan

The app never mentions buying. A new account gets a welcome email (`sendWelcome` in `BE/api/src/server/broadcasts.ts`) with the
plans on shubix.in; it can be switched off in Admin → Marketing → Emails, and every copy has a "Stop these emails" link.
No button, banner or text in the app may lead to it.

## To do later: buying inside the app

- [ ] Decide: Google Play Billing, or User Choice Billing (check the current fee and rules in Play Console)
- [ ] Create the plans and credit packs as products in Play Console
- [ ] Add billing to `FE/mobile-app` (prices shown from Play, not from our plans)
- [ ] Server: verify each purchase with Google, then give the plan or credits to the same account as Razorpay does
- [ ] Server: handle Google refunds and cancelled purchases (take the plan or credits back)
- [ ] Test with Play's license testers, then update Payments above and in `docs/android-release.md`

## Store listing

`icon-512.png` (the gold emblem on a clear background, from `FE/web-app/scripts/brand-assets.mjs`) and
`feature-graphic-1024x500.png` are in this folder. The name, short and full descriptions are filled in the Console (the
full one names only what the app does: no voiceover, the microphone is blocked). Phone screenshots go in `screenshots/`:
at least 2, best 4 (Home, Create, the editor, My Reels), 1080 px or more on each side, from the real app.

## Where it stands (2026-11-02)

- [x] App content: privacy, sign-in, ads, content rating, target audience, data safety, government, financial, health
- [x] Store listing: name, descriptions, icon, feature graphic (draft saved)
- [ ] Store listing: phone screenshots
- [ ] Data safety: crash logs "Yes" (above); check Ads says "contains ads"
- [x] Closed testing - Alpha: India, the "Shubix testers" list, feedback at `https://shubix.in/contact`
- [ ] At least 12 testers (better 15-20) in the list: the Gmail each uses on Play
- [ ] A production build (EAS, `docs/android-release.md`): `versionCode` 2 or more (1 is taken), `ADMOB_ANDROID_APP_ID`
- [ ] Release on the closed track, sent for review; testers opt in from the link Play shows and install
- [ ] 14 days with 12+ testers opted in, then Dashboard → Apply for production
