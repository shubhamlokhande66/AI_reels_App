import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useText } from "@shubix/hooks";
import { Card, Icon } from "@shubix/ui-mobile";
import { Logo } from "../atoms/Logo";

/** The sign-in pages' frame (the website's components/molecules/AuthFrame.tsx): back to sign in, the logo on its dark
 * tile, then the card with the page's title and its form. */
export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  const text = useText();
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="mx-auto w-full max-w-[420px] gap-4 px-6 py-7" keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.replace("/login")} accessibilityRole="link" className="flex-row items-center gap-2 self-start py-1">
        <Icon name="back" size={18} color="muted" /><Text className="text-[12.5px] font-bold text-muted">{text("auth.back")}</Text>
      </Pressable>
      <View className="items-center"><View className="rounded-2xl bg-[#10100f] px-4 py-3"><Logo height={56} /></View></View>
      <Card className="gap-3"><Text className="text-[21px] font-semibold tracking-[-0.3px] text-foreground">{title}</Text>{children}</Card>
    </ScrollView>
  );
}
