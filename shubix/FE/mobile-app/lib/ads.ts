import { TurboModuleRegistry } from "react-native";
import type * as Ads from "react-native-google-mobile-ads";

/** Google AdMob on the phone (ads.web.ts: none in a browser). Only when the app has AdMob inside it (a development or
 * store build): Expo Go has not, and loading it there stops the app, so there, as in a browser, AdBanner shows the
 * app's own card. */
const lib: typeof Ads | null = TurboModuleRegistry.get("RNGoogleMobileAdsModule") ? require("react-native-google-mobile-ads") : null;
export const BannerAd = lib?.BannerAd ?? null;
export const BannerAdSize = lib?.BannerAdSize ?? { ANCHORED_ADAPTIVE_BANNER: "" as const };
export const TestIds = lib?.TestIds ?? { ADAPTIVE_BANNER: "" as const };
