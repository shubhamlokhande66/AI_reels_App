import { Text, View } from "react-native";
import { Icon } from "./Icon";
export function Brand({ small = false }: { small?: boolean }) {
  return <View className="flex-row items-center gap-2"><View className="h-9 w-9 items-center justify-center rounded-xl border border-accent/30 bg-surface-2"><Icon name="sparkle" size={17} color="accent" /></View><Text className={`font-bold tracking-[2px] text-foreground ${small ? "text-[13px]" : "text-[16px]"}`}>SHUBIX</Text></View>;
}
