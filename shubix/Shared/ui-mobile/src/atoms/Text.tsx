import type { ReactNode } from "react";
import { Text, View } from "react-native";

/** The website's headings (components/atoms/Heading.tsx), its phone sizes: page 24, title 17, section 15. */
export type HeadingSize = "page" | "title" | "section";
const SIZE: Record<HeadingSize, string> = {
  page: "text-[24px] leading-[28px] tracking-[-0.48px]",
  title: "text-[17px] leading-[21px] tracking-[-0.17px]",
  section: "text-[15px] tracking-[-0.08px]",
};
export const Heading = ({ size = "title", className = "", children }: { size?: HeadingSize; className?: string; children: ReactNode }) =>
  <Text accessibilityRole="header" className={`font-semibold text-foreground ${SIZE[size]} ${className}`}>{children}</Text>;

/** A small spaced-out label above a heading or a group ("STUDIO"). */
export const Eyebrow = ({ className = "", children }: { className?: string; children: ReactNode }) =>
  <Text className={`text-[11px] font-bold uppercase tracking-[2.2px] text-muted ${className}`}>{children}</Text>;

/** A small pill: a status, a plan, a duration ("15s"). `className`: the pill (place, height, padding); `textClassName`:
 * its words (size, case). It keeps its own size and sits at the start of its line unless placed otherwise. */
export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "dark";
const TONE: Record<BadgeTone, [string, string]> = {
  neutral: ["bg-surface-2", "text-muted"],
  brand: ["bg-accent/15", "text-accent"],
  success: ["bg-success/15", "text-success"],
  warning: ["bg-warning/15", "text-warning"],
  danger: ["bg-danger/15", "text-danger"],
  dark: ["border border-white/25 bg-black/65", "text-white"],
};
/** a default class, unless the caller already set that property */
const unless = (classes: string, prefix: string, fallback: string) => (new RegExp(`(^|\\s)${prefix}`).test(classes) ? "" : fallback);
export function Badge({ tone = "neutral", className = "", textClassName = "", children }: { tone?: BadgeTone; className?: string; textClassName?: string; children: ReactNode }) {
  const [box, words] = TONE[tone];
  return (
    <View className={`flex-row items-center justify-center gap-1 overflow-hidden rounded-full ${unless(className, "h-", "h-[22px]")} ${unless(className, "px-", "px-2.5")} ${unless(className, "(self-|absolute)", "self-start")} ${box} ${className}`}>
      <Text numberOfLines={1} className={`font-bold ${unless(textClassName, "text-\\[", "text-[11px]")} ${words} ${textClassName}`}>{children}</Text>
    </View>
  );
}
