import { useEffect, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { colors } from "@mobile/ui-mobile";
import { useText } from "@mobile/hooks";
import { router } from "expo-router";
import { useLockCheck } from "../../lib/data";

/** A page that opens on a plan (Shared/core plan-locks "page:…", by its address): on a lower plan, straight to
 * your credits instead (the website's PlanGate). */
export function PlanGate({ href, children }: { href: string; children: ReactNode }) {
  const text = useText(), check = useLockCheck(), need = check ? check(href) : "";
  useEffect(() => { if (need) router.replace({ pathname: "/credits", params: { need: href } }); }, [need, href]);
  // not known yet, or on its way to your credits: say which, never a blank screen
  if (!check || need) return (
    <View className="min-h-[40%] flex-1 items-center justify-center gap-3 bg-background px-6">
      <ActivityIndicator color={colors.accent} />
      <Text className="text-center text-sm text-muted">{need ? text("credits.notInPlan") : "Checking your plan…"}</Text>
    </View>
  );
  return <>{children}</>;
}
