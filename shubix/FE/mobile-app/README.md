# Shubix Android app

The Expo + React Native app of the Shubix monorepo (FE/mobile-app). It replaces the old Capacitor shells, which were not moved. The visual direction follows its graphite, ivory, and champagne palette; NativeWind provides Tailwind-style classes and Expo Router provides native routes.

## Start on Android

1. Install Node.js 22.13 or newer and Android Studio (or Expo Go for an initial device preview).
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to BE/api (the monorepo backend, port 4000). The default host works only in the Android emulator; a physical phone needs a reachable LAN or HTTPS address.
4. Run `npx expo install --fix` to align Expo native modules with the selected SDK, then `npm run android`.

The app targets Expo SDK 57 / React Native 0.86, the Expo Router file-based navigation, and stable NativeWind 4.2.7 with Tailwind CSS 3.4. Expo's current guidance recommends Expo Router for new native apps, and NativeWind's stable setup documents SDK 57 support.

## Porting plan and parity

The mobile implementation is being built natively. Browser-only components and the WebCodecs editor cannot be copied into React Native unchanged. Each screen needs native UI and device services while sharing the same API contracts and product rules.

| Existing app area | Native route | Status |
| --- | --- | --- |
| Home dashboard | `/(tabs)` | Native dashboard and navigation |
| Reel creation modes | `/create` | Mode selection, native media picking and private draft storage |
| Reel editing | `/editor/[id]` | Native timeline and editing controls; native video renderer remains to be ported |
| My Reels | `/(tabs)/reels` | Account library listing, opening and deletion |
| Templates | `/(tabs)/templates` | Live catalog, search and create-from-template entry point |
| Account / sign-in | `/(tabs)/profile`, `/auth/*` | Native auth forms and secure token storage |
| Pricing, brands, voices, trends, rewards, settings, legal and support | `/pricing`, `/brands`, `/voices`, `/trends`, `/rewards`, `/settings`, `/privacy`, `/terms`, `/contact` | Native screens with calls to the existing server |

## Important remaining work

- Endpoint types, schemas and the sign-in logic live in `Shared/*` (`@shubix/types`, `@shubix/validations`, `@shubix/api-client`, `@shubix/hooks`); the screens use the atoms/molecules of `@shubix/ui-mobile`.
- Verify native sign-in and existing API behavior against a reachable backend host on an Android device.
- Replace browser media analysis and WebCodecs export with Android-native media probing, timeline transforms, rendering, audio mixing, progress, background recovery, and saving/sharing.
- Ads: Google AdMob banners (AdBanner) in the same spots and for the same plans as the website (AdSense there); the AdMob app ids come from ADMOB_ANDROID_APP_ID / ADMOB_IOS_APP_ID at build time (Google test ids otherwise), the banner ad units from Admin → Settings → Ads. Needs a development build (not Expo Go). The affiliate program is on the website only.
- Port the admin-only console and remaining secondary account flows, then run a complete route-by-route parity review.
- Build and run on an Android emulator and a physical device, then compare each important screen against the web reference and address phone-size issues.

Checked: `tsc --noEmit` passes, `npx expo export --platform android` bundles, `npx expo install --check` matches SDK 57 (except TypeScript 6, a dev tool). Not run yet on an emulator or a phone.
