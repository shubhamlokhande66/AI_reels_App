import { router } from "expo-router";
import { BadgeCheck, ChevronRight, CircleHelp, CreditCard, Gift, Mic2, Settings2, ShieldCheck, Sparkles, UserRound } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { Brand, Eyebrow, Heading, Page, colors } from "@shubix/ui-mobile";
const links = [
  { title: "My account", sub: "Profile and preferences", icon: UserRound, route: "/(tabs)/profile" },
  { title: "Pricing & plans", sub: "Find the plan that fits your studio", icon: CreditCard, route: "/pricing" },
  { title: "My brands", sub: "Your colors and identity", icon: BadgeCheck, route: "/brands" },
  { title: "Voice profiles", sub: "Your saved voice styles", icon: Mic2, route: "/voices" },
  { title: "Invite & earn", sub: "Share Shubix with a friend", icon: Gift, route: "/rewards" },
  { title: "My trends", sub: "Saved creative references", icon: Sparkles, route: "/trends" },
  { title: "Settings", sub: "Privacy and app preferences", icon: Settings2, route: "/settings" },
  { title: "Help & support", sub: "We're here to help", icon: CircleHelp, route: "/contact" },
  { title: "Privacy & terms", sub: "How we look after your work", icon: ShieldCheck, route: "/privacy" },
];
export default function MoreScreen() { return <Page><View className="mt-3"><Brand/><Eyebrow>YOUR SHUBIX SPACE</Eyebrow><Heading size="page" className="mt-2">More to explore.</Heading><Text className="mt-2 text-sm leading-6 text-muted">Everything you need to make the studio your own.</Text></View><View className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">{links.map(({ title, sub, icon: Icon, route }, i) => <Pressable key={title} onPress={() => router.push(route as never)} className={`flex-row items-center gap-3 px-4 py-3.5 ${i ? "border-t border-border" : ""}`}><View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-2"><Icon size={17} color={colors.accent}/></View><View className="flex-1"><Text className="text-sm font-semibold text-foreground">{title}</Text><Text className="mt-0.5 text-[11px] text-muted">{sub}</Text></View><ChevronRight size={17} color={colors.muted}/></Pressable>)}</View><Text className="mt-6 text-center text-[10px] text-muted">SHUBIX · REELS STUDIO</Text></Page>; }
