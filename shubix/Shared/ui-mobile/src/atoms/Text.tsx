import type { ReactNode } from "react";
import { Text } from "react-native";

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

/** A small pill: a status, a plan, a duration ("15s"). */
export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "dark";
const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted",
  brand: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  dark: "border border-white/25 bg-black/65 text-white",
};
export const Badge = ({ tone = "neutral", className = "", children }: { tone?: BadgeTone; className?: string; children: ReactNode }) =>
  <Text className={`h-[22px] self-start overflow-hidden rounded-full px-2.5 text-[11px] font-bold leading-[22px] ${TONE[tone]} ${className}`}>{children}</Text>;
