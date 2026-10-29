import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import { C } from "../colors";
/** The one button: brand gold for the main action, `secondary` a quiet surface. */
export function Button({ title, onPress, secondary = false, loading = false, disabled = false, icon }: { title: string; onPress: () => void; secondary?: boolean; loading?: boolean; disabled?: boolean; icon?: ReactNode }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityState={{ busy: loading, disabled }}
      className={`min-h-[50px] flex-row items-center justify-center gap-2 rounded-2xl px-5 active:opacity-75 ${secondary ? "border border-line bg-panel" : "bg-champagne"} ${disabled ? "opacity-50" : ""}`}>
      {loading ? <ActivityIndicator size="small" color={secondary ? C.ivory : C.bg} /> : icon}
      <Text className={`text-sm font-bold ${secondary ? "text-ivory" : "text-ink"}`}>{title}</Text>
    </Pressable>
  );
}
