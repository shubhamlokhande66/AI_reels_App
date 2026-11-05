import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BannerAd, BannerAdSize, TestIds, adsInApp, adsReady, loadRewarded, type RewardAd } from "../../lib/ads";
import { reportProblem } from "../../lib/errors";
import { useApi, useText } from "@mobile/hooks";
import { Button, Card, tell } from "@mobile/ui-mobile";
import { mobileApi, type AdPlace } from "../../lib/api";

/** An ad for the plans that show ads (Free by default) in one of the spots the administrator left on (Admin → Settings →
 * Ads), the same rule as the website's AdSlot: Google AdMob here (the website uses AdSense), Google's test ads in a
 * development build. Without an AdMob ad unit, in a browser (Expo web), or when no ad loads, nothing. */
/** The administrator's ad settings and whether this person's plan shows ads (Free by default) with ads on. */
export function useAdPlan() {
  const ads = useQuery({ queryKey: ["native-ads"], queryFn: mobileApi.ads, staleTime: 300_000 });
  const plans = useQuery({ queryKey: ["native-plans"], queryFn: mobileApi.pricing, staleTime: 300_000 });
  const credits = useQuery({ queryKey: ["native-credits"], queryFn: mobileApi.credits, staleTime: 60_000, retry: false });
  const c = credits.data, plan = c?.enabled ? plans.data?.plans.find((p) => p.id === c.plan) : undefined;
  return { ads, credits, adPlan: !!c?.enabled && !!plan && (plan.ads ?? plan.id === "free") && ads.data?.enabled !== false };
}

/** Watch a rewarded ad for credits (any plan, with credits on): the server gives them once AdMob confirms the ad was
 * watched, up to the administrator's number a day. */
export function RewardedAdCard() {
  const text = useText(), { me } = useApi(), { ads, credits } = useAdPlan(), qc = useQueryClient(), [busy, setBusy] = useState(false), [ad, setAd] = useState<RewardAd | null>(null);
  const a = ads.data?.admob, unit = Platform.OS === "android" ? a?.rewarded : "", userId = me?.user?.id;
  const offered = !!(adsInApp && unit && userId && credits.data?.enabled && ads.data?.enabled !== false && a?.rewardCredits);
  // the card shows only with an ad ready to play: no button that answers "no ad"; none yet: tried again in a minute
  useEffect(() => {
    if (!offered || ad) return;
    let live = true, later: ReturnType<typeof setTimeout>;
    const load = () => loadRewarded(unit!, userId!).then((r) => { if (live) setAd(r); }).catch((e: { code?: string; message?: string }) => {
      reportProblem(`Rewarded ad: ${e.code ?? e.message ?? "no ad"}`);
      if (live) later = setTimeout(load, 60_000);
    });
    void load();
    return () => { live = false; clearTimeout(later); };
  }, [offered, ad, unit, userId]);
  if (!offered || !ad) return null;
  const watch = async () => {
    setBusy(true);
    const earned = await ad.watch().catch(() => false);
    setBusy(false); setAd(null); // an ad plays once: the next one loads
    if (!earned) return tell(text("ads.rewardEarly"), "info");
    tell(text("ads.rewardDone", { n: a!.rewardCredits! }), "success");
    setTimeout(() => void qc.invalidateQueries({ queryKey: ["native-credits"] }), 4000); // AdMob calls the server within seconds
  };
  return (
    <Card className="gap-3">
      <Text className="text-[15px] font-bold text-foreground">{text("ads.rewardTitle", { n: a!.rewardCredits! })}</Text>
      <Text className="text-[12.5px] text-muted">{text("ads.rewardSub", { n: a!.rewardDaily ?? 5 })}</Text>
      <Button icon="play" title={text("ads.rewardWatch")} loading={busy} onPress={() => void watch()} />
    </Card>
  );
}

export function AdBanner({ place }: { place: AdPlace }) {
  const text = useText(), [failed, setFailed] = useState(false), [ready, setReady] = useState(false);
  const { ads, adPlan, credits } = useAdPlan(), show = adPlan && ads.data?.places?.[place] !== false;
  useEffect(() => { if (show) void adsReady().then(setReady); }, [show]); // consent first, then the ad
  if (!show || !credits.data) return null;
  const unit = __DEV__ ? TestIds.ADAPTIVE_BANNER : Platform.OS === "ios" ? ads.data?.admob?.ios : ads.data?.admob?.android;
  if (!BannerAd || !unit || failed || !ready) return null;
  return (
    <View accessibilityLabel="Advertisement" className="overflow-hidden rounded-2xl border border-border bg-surface p-2">
      <Text className="mb-1 text-[10px] uppercase tracking-[1px] text-muted">{text("plan.adLabel")}</Text>
      <BannerAd unitId={unit} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} onAdFailedToLoad={() => setFailed(true)} />
    </View>
  );
}
