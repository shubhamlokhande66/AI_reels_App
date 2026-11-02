import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useLockCheck } from "../../lib/data";

/** A page that opens on a plan (Shared/core plan-locks "page:…", by its address): on a lower plan, straight to
 * your credits instead (the website's PlanGate). */
export function PlanGate({ href, children }: { href: string; children: ReactNode }) {
  const check = useLockCheck(), need = check ? check(href) : "";
  useEffect(() => { if (need) router.replace({ pathname: "/credits", params: { need: href } }); }, [need, href]);
  if (!check || need) return <View className="min-h-[40%] flex-1 bg-background" />; // not known yet, or on its way to your credits
  return <>{children}</>;
}
