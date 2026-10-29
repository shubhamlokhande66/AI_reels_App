import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../colors";
import { Icon } from "../atoms/Icon";

/** A section's title with its "See All ›" link (the website's components/molecules/SectionHeader.tsx). */
export function SectionHeader({ title, more, onPress, className = "" }: { title: string; more?: string; onPress?: () => void; className?: string }) {
  return (
    <View className={`flex-row items-center justify-between gap-3 ${className}`}>
      <Text accessibilityRole="header" className="text-[17px] font-semibold tracking-[-0.17px] text-foreground">{title}</Text>
      {onPress && more && (
        <Pressable onPress={onPress} accessibilityRole="link" className="flex-row items-center gap-0.5 active:opacity-70">
          <Text className="text-[13px] font-semibold text-muted">{more}</Text>
          <Icon name="chevron" size={16} stroke={2.2} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

/** A row that scrolls sideways (snapping to each card), inside the page's side padding. `step`: a card's width. */
export function Scroller({ label, step, children }: { label: string; step?: number; children: ReactNode }) {
  return (
    <ScrollView horizontal accessibilityLabel={label} showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 pb-1"
      snapToInterval={step ? step + 12 : undefined} decelerationRate={step ? "fast" : "normal"}>
      {children}
    </ScrollView>
  );
}
