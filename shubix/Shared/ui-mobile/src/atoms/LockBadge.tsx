import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { gradients } from "@shubix/ui-core";
import { Icon } from "./Icon";

const ink = gradients.lockInk[0];
const Fill = () => <LinearGradient colors={gradients.lock as unknown as [string, string, string]} locations={[0, 0.42, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />;

/** The tag on a page of a higher plan (the website's components/molecules/LockBadge.tsx), in its gold: on a card
 * (`card`) a pill with a crown and the word ("Upgrade"); in the menu a crown coin. `label`: the word (CMS plan.lockTag). */
export function LockBadge({ label, card = false }: { label: string; card?: boolean }) {
  if (!card) return (
    <View accessibilityLabel={label} className="ml-auto h-[22px] w-[22px] items-center justify-center overflow-hidden rounded-full"><Fill /><Icon name="crown" size={12} stroke={2.4} color={ink} /></View>
  );
  return (
    <View className="h-6 flex-row items-center gap-1 self-start overflow-hidden rounded-full px-2.5">
      <Fill />
      <Icon name="crown" size={12} stroke={2.4} color={ink} />
      <Text className="text-[10px] font-extrabold uppercase tracking-[0.8px]" style={{ color: ink }}>{label}</Text>
    </View>
  );
}
