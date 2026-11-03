import type { ConfigContext, ExpoConfig } from "expo/config";

/** app.json plus what comes from the build: the AdMob app ids (AdMob → Apps → App settings). They are built into the
 * app; without them it uses Google's sample app ids, which show test ads only. The banner ad units are set by the
 * administrator (Admin → Settings → Ads) and read at run time. */
const GOOGLE_TEST_APP = { android: "ca-app-pub-3940256099942544~3347511713", ios: "ca-app-pub-3940256099942544~1458002511" };

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: [
    ...(config.plugins ?? []),
    ["react-native-google-mobile-ads", {
      androidAppId: process.env.ADMOB_ANDROID_APP_ID || GOOGLE_TEST_APP.android,
      iosAppId: process.env.ADMOB_IOS_APP_ID || GOOGLE_TEST_APP.ios,
      delayAppMeasurementInit: true, // nothing is measured before the consent answer (lib/ads.ts)
    }],
    // R8 (on by default in release builds) removed WorkManager's database class: the app closed at start
    ["expo-build-properties", { android: { enableMinifyInReleaseBuilds: false, enableShrinkResourcesInReleaseBuilds: false } }],
    "./plugins/with-upload-key", // the Play upload key in release builds (plugins/with-upload-key.js)
  ],
});
