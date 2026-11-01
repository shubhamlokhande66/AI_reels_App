import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

/** The website's chip (Shared/ui-web/src/chip.ts): a pill to pick one of a few (a tab, a filter, a style). */
export function Chip({ label, on = false, onPress, icon, count, tall = false }: { label: string; on?: boolean; onPress: () => void; icon?: ReactNode; count?: number; tall?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      className={`flex-row items-center gap-1.5 rounded-full border px-3.5 active:opacity-80 ${tall ? "h-9" : "h-[34px]"} ${on ? "border-accent bg-chip-on" : "border-border bg-surface"}`}>
      {icon}
      <Text numberOfLines={1} className={`font-semibold text-foreground ${tall ? "text-[11.5px]" : "text-[12.5px]"}`}>{label}</Text>
      {count !== undefined && <View className="rounded-full bg-surface-2 px-1.5"><Text className="text-[10px] text-muted">{count}</Text></View>}
    </Pressable>
  );
}

/** The website's segmented control (Shared/ui-web/src/seg.ts): one of a few side by side. small: compact; full: the
 * whole width, shared. */
export function Segmented<T extends string>({ value, options, onChange, small = false, full = false }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void; small?: boolean; full?: boolean }) {
  return (
    <View className={`flex-row gap-[3px] rounded-[14px] border border-border bg-surface-2 p-[3px] ${full ? "w-full" : "self-start"}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            className={`items-center justify-center rounded-[10px] border ${on ? "border-accent/55 bg-chip-on" : "border-transparent"} ${small ? "px-2.5 py-1.5" : "px-3.5 py-[9px]"} ${full ? "flex-1" : ""}`}>
            <Text numberOfLines={1} className={`font-semibold ${on ? "text-foreground" : "text-muted"} ${small ? "text-[12px]" : "text-[13px]"}`}>{o.label}{o.count !== undefined && <Text className="text-[11px] text-muted">  {o.count}</Text>}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The website's tool tile (Shared/ui-web/src/tile.ts): an icon over its name. on: chosen; danger: red (Delete). */
export function Tile({ label, icon, on = false, danger = false, onPress, className = "" }: { label: string; icon: ReactNode; on?: boolean; danger?: boolean; onPress: () => void; className?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      className={`min-w-0 items-center justify-center gap-1.5 rounded-[11px] border p-1.5 active:bg-accent/10 ${on ? "border-accent/30 bg-accent/13" : "border-transparent"} ${className}`}>
      {icon}
      <Text numberOfLines={2} className={`text-center text-[11px] font-medium leading-tight ${danger ? "text-danger" : on ? "text-accent" : "text-muted"}`}>{label}</Text>
    </Pressable>
  );
}
