import { TurboModuleRegistry } from "react-native";
import type * as Ads from "react-native-google-mobile-ads";

/** Google AdMob on the phone (ads.web.ts: none in a browser). Only when the app has AdMob inside it (a development or
 * store build): Expo Go has not, and loading it there stops the app, so there, as in a browser, AdBanner shows the
 * app's own card. */
const lib: typeof Ads | null = TurboModuleRegistry.get("RNGoogleMobileAdsModule") ? require("react-native-google-mobile-ads") : null;
export const BannerAd = lib?.BannerAd ?? null;
export const BannerAdSize = lib?.BannerAdSize ?? { ANCHORED_ADAPTIVE_BANNER: "" as const };
export const TestIds = lib?.TestIds ?? { ADAPTIVE_BANNER: "" as const };

/** Once per run, before the first ad: Google's consent form where the law asks for it (the message is set in AdMob →
 * Privacy & messaging), then AdMob starts. False: no ads may be asked for. */
let ready: Promise<boolean> | null = null;
export const adsReady = () => ready ??= (async () => {
  if (!lib) return false;
  const can = await lib.AdsConsent.gatherConsent().then((c) => c.canRequestAds).catch(() => false);
  if (can || __DEV__) await lib.default().initialize();
  return can || __DEV__;
})();
/** Whether this person must be able to change their answer (My account → Ad privacy choices). */
export const adChoicesNeeded = async () => !!lib && (await lib.AdsConsent.getConsentInfo()).privacyOptionsRequirementStatus === "REQUIRED";
export const showAdChoices = async () => { await lib?.AdsConsent.showPrivacyOptionsForm(); };
