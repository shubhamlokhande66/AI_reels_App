import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import type { IconName } from "@mobile/ui-core";
import { useColors, type ColorName } from "../theme";
import { mix } from "../colors";
import { Gold } from "./Gold";
import { Icon } from "./Icon";

/** The website's one button (Shared/ui-web/src/button.ts), the same sizes and looks. primary: the gold gradient for
 * the main action; secondary: a quiet surface; ghost: no fill; danger: red words; destroy: red, for what cannot be undone. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "destroy";
export type ButtonSize = "sm" | "md" | "lg" | "xl";
const VARIANT: Record<ButtonVariant, { box: string; text: string; color: ColorName }> = {
  primary: { box: "border border-transparent", text: "text-on-accent", color: "onAccent" as ColorName },
  secondary: { box: "border border-border bg-surface", text: "text-foreground", color: "foreground" as ColorName },
  ghost: { box: "border border-transparent", text: "text-foreground", color: "foreground" as ColorName },
  danger: { box: "border border-danger/35 bg-surface", text: "text-danger", color: "danger" as ColorName },
  destroy: { box: "border border-transparent bg-danger", text: "text-white", color: "#fff" as ColorName },
};
const SIZE: Record<ButtonSize, { box: string; text: string; icon: number }> = {
  sm: { box: "h-9 rounded-[10px] px-3", text: "text-[12px]", icon: 15 },
  md: { box: "h-10 rounded-xl px-3.5", text: "text-[13px]", icon: 16 },
  lg: { box: "h-12 rounded-xl px-5", text: "text-[14px]", icon: 18 },
  xl: { box: "h-[52px] rounded-[14px] px-5", text: "text-[16px]", icon: 20 }, // the phones' bottom button (the studio's phoneBottomButton)
};

export function Button({ title, onPress, variant = "primary", size = "md", full = false, icon, iconAfter, loading = false, disabled = false, className = "" }: { title: string; onPress: () => void; variant?: ButtonVariant; size?: ButtonSize; full?: boolean; icon?: IconName | ReactNode; iconAfter?: IconName; loading?: boolean; disabled?: boolean; className?: string }) {
  const v = VARIANT[variant], s = SIZE[size], look = useColors() as Record<string, string>;
  // off: a solid, quieter look of its own, never see-through (a bottom button over the page must not show the page through it)
  const off = disabled && !loading;
  const offBg = variant === "primary" ? mix(look.accent, look.raised, 0.24) : variant === "destroy" ? mix(look.danger, look.raised, 0.35) : look.raised;
  const offInk = variant === "primary" ? mix(look.accent, look.foreground, 0.72) : look.muted;
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityState={{ busy: loading, disabled }}
      style={off ? { backgroundColor: offBg } : undefined}
      className={`flex-row items-center justify-center gap-2 overflow-hidden active:opacity-80 ${v.box} ${s.box} ${full ? "w-full" : "self-start"} ${className}`}>
      {variant === "primary" && !off && <Gold />}
      {loading ? <ActivityIndicator size="small" color={look[v.color] ?? v.color} /> : typeof icon === "string" ? <Icon name={icon as IconName} size={s.icon} color={(off ? offInk : v.color) as ColorName} /> : icon}
      <Text numberOfLines={1} style={off ? { color: offInk } : undefined} className={`font-bold ${v.text} ${s.text}`}>{title}</Text>
      {iconAfter && <Icon name={iconAfter} size={s.icon} color={(off ? offInk : v.color) as ColorName} />}
    </Pressable>
  );
}

/** A round button with only an icon (back, undo, send…): `label` is what screen readers say. box: bordered surface;
 * plain: no border or fill; muted: grey; danger: red; main: the gold gradient. */
const ICON_LOOK = {
  box: { box: "border border-border bg-surface", color: "foreground" as ColorName },
  plain: { box: "", color: "foreground" as ColorName },
  muted: { box: "", color: "muted" as ColorName },
  danger: { box: "", color: "danger" as ColorName },
  main: { box: "", color: "onAccent" as ColorName },
};
export function IconButton({ icon, label, onPress, size = 44, iconSize, look = "box", disabled = false, className = "" }: { icon: IconName; label: string; onPress: () => void; size?: number; iconSize?: number; look?: keyof typeof ICON_LOOK; disabled?: boolean; className?: string }) {
  const l = ICON_LOOK[look];
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={{ width: size, height: size }}
      className={`items-center justify-center overflow-hidden rounded-full active:opacity-70 ${l.box} ${className}`}>
      {look === "main" && !disabled && <Gold />}
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.45)} color={disabled ? "muted" : l.color} />
    </Pressable>
  );
}
