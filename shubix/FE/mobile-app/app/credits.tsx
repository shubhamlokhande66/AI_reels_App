import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useText } from "@shubix/hooks";
import { Badge, Card, ErrorBanner, Icon, Page, SectionHeader, useColors } from "@shubix/ui-mobile";
import type { Credits } from "@shubix/types";
import { errorMessage } from "@shubix/api-client";
import { mobileApi } from "../lib/api";
import { RewardedAdCard } from "../components/molecules/AdBanner";
import { useCredits } from "../lib/data";

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** Your plan and credits. Google Play: plans and credits are bought on the website only, so the app shows no prices, no
 * way to buy and no way there. Every text: Admin → CMS. */
export default function CreditsScreen() {
  const text = useText(), look = useColors(), { need } = useLocalSearchParams<{ need?: string }>();
  const plans = useQuery({ queryKey: ["native-plans"], queryFn: mobileApi.pricing, staleTime: 300_000 });
  const credits = useCredits().data, mine = credits?.enabled ? credits : null;
  if (plans.isLoading) return <Page><ActivityIndicator color={look.accent} /></Page>;
  if (plans.error || !plans.data) return <Page><ErrorBanner message={errorMessage(plans.error ?? new Error("Credits are not available."))} /></Page>;
  const costs = plans.data.creditCosts.filter((c) => c.id.startsWith("studio_") || c.credits > 0).filter((c) => !["clip_reel", "version", "story_render", "preview"].includes(c.id));
  return (
    <Page>
      <View className="gap-6 pb-4">
        {!!need && <Text className="text-center text-[14px] font-semibold text-muted">{text("credits.notInPlan")}</Text>}
        {mine && <MyCredits c={mine} />}
        <RewardedAdCard />
        <View className="gap-3">
          <SectionHeader title={text("pricing.costsTitle")} />
          <Card className="p-2">
            {costs.map((c, i) => (
              <View key={c.id} className={`flex-row items-center justify-between gap-3 px-3 py-3.5 ${i < costs.length - 1 ? "border-b border-border" : ""}`}>
                <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                  <View className="h-7 w-7 items-center justify-center rounded-lg bg-accent/[0.12]"><Icon name={c.credits === 0 ? "sparkle" : "bolt"} size={15} stroke={2} color="accent" /></View>
                  <Text className="min-w-0 flex-1 text-[14px] font-semibold text-foreground">{c.action}</Text>
                </View>
                <Badge tone={c.credits === 0 ? "success" : "brand"} className="h-7 px-3" textClassName="text-[12px]">{c.credits === 0 ? text("pricing.costFree") : c.credits === 1 ? text("pricing.costCredit") : text("pricing.costCredits", { n: c.credits })}</Badge>
              </View>
            ))}
          </Card>
        </View>
      </View>
    </Page>
  );
}

/** Your credits: the balance and plan, when it ends or renews, and the last five changes. */
function MyCredits({ c }: { c: Extract<Credits, { enabled: true }> }) {
  const text = useText();
  return (
    <Card className="gap-4">
      <View className="flex-row items-center justify-between gap-3">
        <View>
          <Text className="text-[13px] font-semibold text-muted">{text("pricing.yourCredits")}</Text>
          <View className="flex-row items-center gap-2"><Icon name="bolt" size={26} stroke={2.2} color="accent" /><Text className="text-[28px] font-semibold leading-[34px] text-foreground">{c.balance.toLocaleString("en-IN")}</Text></View>
        </View>
        <Badge tone="brand" className="h-8 px-3" textClassName="text-[12.5px]">{text("pricing.planBadge", { plan: c.planName })}</Badge>
      </View>
      <Text className="text-[12.5px] text-muted">
        {c.plan !== "free" && c.planEnds ? `${text("pricing.activeUntil", { date: day(c.planEnds) })} · ` : ""}
        {c.plan !== "free" && c.renews ? `${text("pricing.renews", { date: day(c.renews) })} · ` : ""}
        {c.extra > 0 ? text("pricing.extraLeft", { n: c.extra.toLocaleString("en-IN") }) : c.plan === "free" ? text("pricing.freeNote") : ""}
      </Text>
      {c.history.length > 0 && (
        <View>
          {c.history.slice(0, 5).map((h, i) => (
            <View key={i} className={`flex-row items-center justify-between gap-3 py-2 ${i ? "border-t border-border" : ""}`}>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[13px] text-muted">{h.reason}</Text>
              <Text className={`text-[13px] font-bold ${h.delta > 0 ? "text-success" : "text-foreground"}`}>{h.delta > 0 ? `+${h.delta.toLocaleString("en-IN")}` : h.delta < 0 ? `−${Math.abs(h.delta).toLocaleString("en-IN")}` : "0"}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
