import { TextInput, View } from "react-native";
import { useColors } from "../theme";
import { Icon } from "../atoms/Icon";

/** The website's search box (components/molecules/SearchBox.tsx): the magnifier and the field, 44px high. */
export function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <View className="h-11 w-full flex-row items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5">
      <Icon name="search" size={17} color="muted" />
      <TextInput value={value} onChangeText={onChange} placeholder={label} accessibilityLabel={label} placeholderTextColor={useColors().muted} returnKeyType="search" className="h-full min-w-0 flex-1 text-[14px] text-foreground" />
    </View>
  );
}
