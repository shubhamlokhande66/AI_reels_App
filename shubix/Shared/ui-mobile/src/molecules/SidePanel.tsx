import type { ReactNode } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "../atoms/Button";

/** The website's side panel (components/molecules/SidePanel.tsx), on a phone the whole screen: where it opened from,
 * its title and the close button, then its content. */
export function SidePanel({ open, onClose, title, where, closeLabel, children }: { open: boolean; onClose: () => void; title: string; where?: string; closeLabel: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-3 border-b border-border px-5 py-4">
          <View className="min-w-0 flex-1">
            {where && <Text numberOfLines={1} className="text-[12px] text-muted">{where}</Text>}
            <Text numberOfLines={1} className="text-[17px] font-semibold text-foreground">{title}</Text>
          </View>
          <IconButton icon="close" label={closeLabel} onPress={onClose} />
        </View>
        <ScrollView contentContainerClassName="p-5" contentContainerStyle={{ paddingBottom: 20 + insets.bottom }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}
