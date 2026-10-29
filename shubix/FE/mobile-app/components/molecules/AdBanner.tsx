import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { BannerAd, BannerAdSize, TestIds } from "../../lib/ads";
import { useText } from "@shubix/hooks";
import { mobileApi, type AdPlace } from "../../lib/api";

/** An ad for the plans that show ads (Free by default) in one of the spots the administrator left on (Admin → Settings →
 * Ads), the same rule as the website's AdSlot: Google AdMob here (the website uses AdSense), Google's test ads in a
 * development build. Without an AdMob ad unit, in a browser (Expo web), or when no ad loads, the app's own card for the paid plans. */
export function AdBanner({ place }: { place: AdPlace }) {
  const text = useText(), [failed, setFailed] = useState(false);
  const ads = useQuery({ queryKey: ["native-ads"], queryFn: mobileApi.ads, staleTime: 300_000 });
  const plans = useQuery({ queryKey: ["native-plans"], queryFn: mobileApi.pricing, staleTime: 300_000 });
  const credits = useQuery({ queryKey: ["native-credits"], queryFn: mobileApi.credits, staleTime: 60_000, retry: false });
  const c = credits.data, plan = c?.enabled ? plans.data?.plans.find((p) => p.id === c.plan) : undefined;
  const show = !!c?.enabled && !!plan && (plan.ads ?? plan.id === "free") && ads.data?.enabled !== false && ads.data?.places?.[place] !== false;
  if (!show) return null;
  const unit = __DEV__ ? TestIds.ADAPTIVE_BANNER : Platform.OS === "ios" ? ads.data?.admob?.ios : ads.data?.admob?.android;
  if (BannerAd && unit && !failed) return (
    <View accessibilityLabel="Advertisement" className="overflow-hidden rounded-2xl border border-border bg-surface p-2">
      <Pressable onPress={() => router.push("/pricing")}><Text className="mb-1 text-[10px] uppercase tracking-[1px] text-muted">{text("plan.adLabel")} · <Text className="underline">{text("plan.removeAds")}</Text></Text></Pressable>
      <BannerAd unitId={unit} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} onAdFailedToLoad={() => setFailed(true)} />
    </View>
  );
  const price = plans.data?.plans.find((p) => p.id !== "free" && !p.hidden)?.monthly ?? 199;
  return (
    <Pressable onPress={() => router.push("/pricing")} className="rounded-2xl border border-border bg-surface p-4 active:opacity-75">
      <Text className="text-[15px] font-bold text-foreground">{text("plan.aiAdTitle")}</Text>
      <Text className="mt-1 text-xs leading-5 text-muted">{text("plan.aiAdText", { price: `₹${price}` })}</Text>
      <Text className="mt-2 text-xs font-semibold text-accent">{text("plan.aiAdButton")}</Text>
    </Pressable>
  );
}
