import { Text, View } from "react-native";
import { Sparkles } from "lucide-react-native";
import { colors } from "../colors";
export function Brand({ small = false }: { small?: boolean }) {
  return <View className="flex-row items-center gap-2"><View className="h-9 w-9 items-center justify-center rounded-xl border border-accent/30 bg-surface-2"><Sparkles size={17} color={colors.accent} /></View><Text className={`font-bold tracking-[2px] text-foreground ${small ? "text-[13px]" : "text-[16px]"}`}>SHUBIX</Text></View>;
}
