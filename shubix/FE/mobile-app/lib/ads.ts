import { TurboModuleRegistry } from "react-native";
import type * as Ads from "react-native-google-mobile-ads";

/** Google AdMob on the phone (ads.web.ts: none in a browser). Only when the app has AdMob inside it (a development or
 * store build): Expo Go has not, and loading it there stops the app, so there, as in a browser, AdBanner shows the
 * app's own card. */
const lib: typeof Ads | null = TurboModuleRegistry.get("RNGoogleMobileAdsModule") ? require("react-native-google-mobile-ads") : null;
export const BannerAd = lib?.BannerAd ?? null;
export const BannerAdSize = lib?.BannerAdSize ?? { ANCHORED_ADAPTIVE_BANNER: "" as const };
export const TestIds = lib?.TestIds ?? { ADAPTIVE_BANNER: "" as const };
export const adsInApp = !!lib;

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

/** A full-screen ad (after an export on the plans with ads), at most once in 3 minutes; resolves when it is closed. */
let lastFull = 0;
export async function showInterstitial(unit: string): Promise<void> {
  if (!lib || !unit || Date.now() - lastFull < 180_000 || !(await adsReady())) return;
  const ad = lib.InterstitialAd.createForAdRequest(__DEV__ ? lib.TestIds.INTERSTITIAL : unit);
  await new Promise<void>((done) => {
    let shown = false;
    ad.addAdEventListener(lib.AdEventType.LOADED, () => { if (shown) return; shown = true; lastFull = Date.now(); void ad.show().catch(() => done()); });
    ad.addAdEventListener(lib.AdEventType.CLOSED, () => done());
    ad.addAdEventListener(lib.AdEventType.ERROR, () => done());
    ad.load(); setTimeout(() => { shown = true; if (!lastFull || Date.now() - lastFull > 15_000) done(); }, 15_000); // no ad in time: go on
  });
}

/** A rewarded ad: true once it was watched to the end. The credits come from the server (AdMob calls it, signed, with
 * this person's id), never from the phone. */
export async function showRewarded(unit: string, userId: string): Promise<boolean> {
  if (!lib || !unit || !(await adsReady())) return false;
  const ad = lib.RewardedAd.createForAdRequest(__DEV__ ? lib.TestIds.REWARDED : unit, { serverSideVerificationOptions: { userId } });
  return new Promise<boolean>((done) => {
    let earned = false;
    ad.addAdEventListener(lib.RewardedAdEventType.LOADED, () => void ad.show().catch(() => done(false)));
    ad.addAdEventListener(lib.RewardedAdEventType.EARNED_REWARD, () => { earned = true; });
    ad.addAdEventListener(lib.AdEventType.CLOSED, () => done(earned));
    ad.addAdEventListener(lib.AdEventType.ERROR, () => done(false));
    ad.load();
  });
}
