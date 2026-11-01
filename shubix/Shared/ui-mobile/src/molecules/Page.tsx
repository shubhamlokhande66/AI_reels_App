import type { ComponentRef, ReactNode, Ref } from "react";
import { ScrollView, View } from "react-native";

/** A page's content inside the app's frame (the bars handle the phone's edges): the website's phone padding,
 * 16px at the sides and the top, 40px below. `scrollRef`: to scroll to a part of the page. */
export function Page({ children, scroll = true, scrollRef }: { children: ReactNode; scroll?: boolean; scrollRef?: Ref<ComponentRef<typeof ScrollView>> }) {
  return scroll
    ? <ScrollView ref={scrollRef} className="flex-1 bg-background" contentContainerClassName="px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
    : <View className="flex-1 bg-background px-4 pt-4">{children}</View>;
}
