import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export function Page({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return <SafeAreaView className="flex-1 bg-background" edges={["top"]}>{scroll ? <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView> : <View className="flex-1 px-5">{children}</View>}</SafeAreaView>;
}
