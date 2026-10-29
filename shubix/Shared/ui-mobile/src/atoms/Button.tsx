import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import { colors } from "../colors";
/** The one button: brand gold for the main action, `secondary` a quiet surface. */
export function Button({ title, onPress, secondary = false, loading = false, disabled = false, icon }: { title: string; onPress: () => void; secondary?: boolean; loading?: boolean; disabled?: boolean; icon?: ReactNode }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityState={{ busy: loading, disabled }}
      className={`min-h-[50px] flex-row items-center justify-center gap-2 rounded-2xl px-5 active:opacity-75 ${secondary ? "border border-border bg-surface" : "bg-accent"} ${disabled ? "opacity-50" : ""}`}>
      {loading ? <ActivityIndicator size="small" color={secondary ? colors.foreground : colors.background} /> : icon}
      <Text className={`text-sm font-bold ${secondary ? "text-foreground" : "text-on-accent"}`}>{title}</Text>
    </Pressable>
  );
}
