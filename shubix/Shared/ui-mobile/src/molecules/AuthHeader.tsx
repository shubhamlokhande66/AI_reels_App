import { Pressable, Text, View } from "react-native";
import { Sparkles } from "lucide-react-native";
import { Brand } from "../atoms/Brand";
import { Eyebrow, Muted } from "../atoms/Text";
import { C } from "../colors";
/** The top of the sign-in screens: close, brand, the gold tile, a title and line. */
export function AuthHeader({ eyebrow, title, subtitle, onClose, closeLabel = "Close" }: { eyebrow?: string; title: string; subtitle?: string; onClose?: () => void; closeLabel?: string }) {
  return (
    <>
      <View className="mt-3 flex-row items-center justify-between">{onClose ? <Pressable onPress={onClose}><Text className="text-sm text-muted">{closeLabel}</Text></Pressable> : <View />}<Brand small /></View>
      <View className="mt-10">
        <View className="mb-5 h-14 w-14 items-center justify-center rounded-[18px] border border-[#76633b] bg-[#29251c]"><Sparkles size={24} color={C.gold} /></View>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Text className="mt-2 text-[30px] font-semibold text-ivory">{title}</Text>
        {subtitle ? <Muted className="mt-2">{subtitle}</Muted> : null}
      </View>
    </>
  );
}
