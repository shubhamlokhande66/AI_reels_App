import { Text, View } from "react-native";
import { Sparkles } from "lucide-react-native";
import { C } from "../colors";
export function Brand({ small = false }: { small?: boolean }) {
  return <View className="flex-row items-center gap-2"><View className="h-9 w-9 items-center justify-center rounded-xl border border-champagne/30 bg-raised"><Sparkles size={17} color={C.gold} /></View><Text className={`font-bold tracking-[2px] text-ivory ${small ? "text-[13px]" : "text-[16px]"}`}>SHUBIX</Text></View>;
}
