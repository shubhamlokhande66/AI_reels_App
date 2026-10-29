import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import type { IconName } from "@shubix/ui-core";
import { colors } from "../colors";
import { Gold } from "./Gold";
import { Icon } from "./Icon";

/** The website's one button (Shared/ui-web/src/button.ts), the same sizes and looks. primary: the gold gradient for
 * the main action; secondary: a quiet surface; ghost: no fill; danger: red. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
const VARIANT: Record<ButtonVariant, { box: string; text: string; color: string }> = {
  primary: { box: "border border-transparent", text: "text-on-accent", color: colors.onAccent },
  secondary: { box: "border border-border bg-surface", text: "text-foreground", color: colors.foreground },
  ghost: { box: "border border-transparent", text: "text-foreground", color: colors.foreground },
  danger: { box: "border border-danger/35 bg-surface", text: "text-danger", color: colors.danger },
};
const SIZE: Record<ButtonSize, { box: string; text: string; icon: number }> = {
  sm: { box: "h-9 rounded-[10px] px-3", text: "text-[12px]", icon: 15 },
  md: { box: "h-10 rounded-xl px-3.5", text: "text-[13px]", icon: 16 },
  lg: { box: "h-12 rounded-xl px-5", text: "text-[14px]", icon: 18 },
};

export function Button({ title, onPress, variant = "primary", size = "md", full = false, icon, iconAfter, loading = false, disabled = false, className = "" }: { title: string; onPress: () => void; variant?: ButtonVariant; size?: ButtonSize; full?: boolean; icon?: IconName | ReactNode; iconAfter?: IconName; loading?: boolean; disabled?: boolean; className?: string }) {
  const v = VARIANT[variant], s = SIZE[size];
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityState={{ busy: loading, disabled }}
      className={`flex-row items-center justify-center gap-2 overflow-hidden active:opacity-80 ${v.box} ${s.box} ${full ? "w-full" : "self-start"} ${disabled ? "opacity-50" : ""} ${className}`}>
      {variant === "primary" && <Gold />}
      {loading ? <ActivityIndicator size="small" color={v.color} /> : typeof icon === "string" ? <Icon name={icon as IconName} size={s.icon} color={v.color} /> : icon}
      <Text numberOfLines={1} className={`font-bold ${v.text} ${s.text}`}>{title}</Text>
      {iconAfter && <Icon name={iconAfter} size={s.icon} color={v.color} />}
    </Pressable>
  );
}

/** A round button with only an icon (back, undo, send…): `label` is what screen readers say. box: bordered surface;
 * plain: no border or fill; muted: grey; main: the gold gradient. */
const ICON_LOOK = {
  box: { box: "border border-border bg-surface", color: colors.foreground },
  plain: { box: "", color: colors.foreground },
  muted: { box: "", color: colors.muted },
  main: { box: "", color: colors.onAccent },
};
export function IconButton({ icon, label, onPress, size = 44, look = "box", disabled = false, className = "" }: { icon: IconName; label: string; onPress: () => void; size?: number; look?: keyof typeof ICON_LOOK; disabled?: boolean; className?: string }) {
  const l = ICON_LOOK[look];
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={{ width: size, height: size }}
      className={`items-center justify-center overflow-hidden rounded-full active:opacity-70 ${l.box} ${disabled ? "opacity-50" : ""} ${className}`}>
      {look === "main" && <Gold />}
      <Icon name={icon} size={Math.round(size * 0.45)} color={l.color} />
    </Pressable>
  );
}
