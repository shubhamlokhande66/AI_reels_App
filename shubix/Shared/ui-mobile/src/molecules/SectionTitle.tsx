import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { C } from "../colors";
export function SectionTitle({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return <View className="mb-3 mt-7 flex-row items-center justify-between"><Text className="text-[17px] font-semibold text-ivory">{title}</Text>{action && <Pressable onPress={onPress} className="flex-row items-center"><Text className="text-xs font-semibold text-champagne">{action}</Text><ChevronRight size={15} color={C.gold} /></Pressable>}</View>;
}
