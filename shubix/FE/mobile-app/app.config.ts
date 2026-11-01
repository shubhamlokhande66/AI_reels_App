import type { ConfigContext, ExpoConfig } from "expo/config";
import { withGradleProperties } from "expo/config-plugins";

/** app.json plus what comes from the build: the AdMob app ids (AdMob → Apps → App settings). They are built into the
 * app; without them it uses Google's sample app ids, which show test ads only. The banner ad units are set by the
 * administrator (Admin → Settings → Ads) and read at run time. */
const GOOGLE_TEST_APP = { android: "ca-app-pub-3940256099942544~3347511713", ios: "ca-app-pub-3940256099942544~1458002511" };

// Razorpay's two Android libraries share one namespace, which the manifest merger refuses by default.
const allowSharedNamespaces = (config: ExpoConfig) => withGradleProperties(config, (c) => {
  c.modResults.push({ type: "property", key: "android.uniquePackageNames", value: "false" });
  return c;
});

export default ({ config }: ConfigContext): ExpoConfig => allowSharedNamespaces({
  ...(config as ExpoConfig),
  plugins: [
    ...(config.plugins ?? []),
    ["react-native-google-mobile-ads", {
      androidAppId: process.env.ADMOB_ANDROID_APP_ID || GOOGLE_TEST_APP.android,
      iosAppId: process.env.ADMOB_IOS_APP_ID || GOOGLE_TEST_APP.ios,
    }],
  ],
} as ExpoConfig);
