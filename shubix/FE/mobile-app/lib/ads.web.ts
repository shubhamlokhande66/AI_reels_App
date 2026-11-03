/** AdMob has no web version: in a browser AdBanner shows the app's own card. */
export const BannerAd = null;
export const BannerAdSize = { ANCHORED_ADAPTIVE_BANNER: "" } as const;
export const TestIds = { ADAPTIVE_BANNER: "" } as const;
export const adsReady = async () => false;
export const adChoicesNeeded = async () => false;
export const showAdChoices = async () => {};
export const adsInApp = false;
export const showInterstitial = async (_unit: string) => {};
export const showRewarded = async (_unit: string, _userId: string) => false;
