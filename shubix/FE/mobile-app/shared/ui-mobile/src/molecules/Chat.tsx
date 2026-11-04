import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Gold } from "../atoms/Gold";

/** A chat's message (the website's Help chat and Ask Shubix): yours on the right in gold, the answer on the left on the
 * surface. */
export const Bubble = ({ mine = false, children }: { mine?: boolean; children: ReactNode }) => (
  <View className={`max-w-[86%] overflow-hidden rounded-2xl px-3.5 py-2.5 ${mine ? "self-end rounded-br-md" : "self-start rounded-bl-md border border-border bg-surface"}`}>
    {mine && <Gold />}
    {typeof children === "string" ? <Text className={`text-[13.5px] leading-5 ${mine ? "text-on-accent" : "text-foreground"}`}>{children}</Text> : children}
  </View>
);
/** A question to tap (starters, suggestions, "Try:" ideas). */
export const ChatChip = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityRole="button" className="rounded-full border border-accent/35 bg-surface px-3 py-1.5 active:bg-accent/10"><Text className="text-[12.5px] text-foreground">{label}</Text></Pressable>
);
/** The answer being written: three dots. */
export const Typing = ({ label }: { label: string }) => (
  <Bubble><View accessibilityLabel={label} className="flex-row gap-1 py-1">{[0, 1, 2].map((d) => <View key={d} className="h-1.5 w-1.5 rounded-full bg-muted" style={{ opacity: 0.4 + d * 0.25 }} />)}</View></Bubble>
);
