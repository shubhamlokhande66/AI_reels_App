import { forwardRef, type ReactNode } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { C } from "../colors";
/** The text box: an optional icon on the left and a slot on the right. `invalid`: red border. */
export const Input = forwardRef<TextInput, TextInputProps & { icon?: ReactNode; right?: ReactNode; invalid?: boolean }>(function Input({ icon, right, invalid, ...rest }, ref) {
  return (
    <View className={`h-[52px] flex-row items-center gap-3 rounded-2xl border bg-panel px-4 ${invalid ? "border-danger" : "border-line"}`}>
      {icon}
      <TextInput ref={ref} placeholderTextColor={C.muted} className="flex-1 text-sm text-ivory" {...rest} />
      {right}
    </View>
  );
});
