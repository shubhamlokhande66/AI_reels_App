import { Pressable, Text, View } from "react-native";
/** Two buttons, one pressed: Sign in | Create an account. */
export function ModeSwitch<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View className="flex-row gap-1 rounded-xl border border-line bg-raised p-1">
      {options.map((o) => <Pressable key={o.value} accessibilityState={{ selected: o.value === value }} onPress={() => onChange(o.value)} className={`h-9 flex-1 items-center justify-center rounded-lg ${o.value === value ? "bg-panel" : ""}`}>
        <Text className={`text-[13px] font-bold ${o.value === value ? "text-ivory" : "text-muted"}`}>{o.label}</Text></Pressable>)}
    </View>
  );
}
