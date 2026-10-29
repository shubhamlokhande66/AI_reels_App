import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as Ads from "react-native-google-mobile-ads";

/** Google AdMob on the phone (ads.web.ts: none in a browser). Expo Go has no AdMob inside it: there, as in a browser,
 * AdBanner shows the app's own card (a development or store build has the real ads). */
const lib: typeof Ads | null = Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? null : require("react-native-google-mobile-ads");
export const BannerAd = lib?.BannerAd ?? null;
export const BannerAdSize = lib?.BannerAdSize ?? { ANCHORED_ADAPTIVE_BANNER: "" as const };
export const TestIds = lib?.TestIds ?? { ADAPTIVE_BANNER: "" as const };
