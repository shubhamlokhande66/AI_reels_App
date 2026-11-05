import { forwardRef, type ComponentRef, type ReactNode } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { useColors } from "../theme";
/** The text box: an optional icon on the left and a slot on the right. `invalid`: red border. */
export const Input = forwardRef<ComponentRef<typeof TextInput>, TextInputProps & { icon?: ReactNode; right?: ReactNode; invalid?: boolean }>(function Input({ icon, right, invalid, ...rest }, ref) {
  return (
    <View className={`h-[52px] flex-row items-center gap-3 rounded-2xl border bg-surface px-4 ${invalid ? "border-danger" : "border-border"} ${rest.editable === false ? "opacity-60" : ""}`}>
      {icon}
      <TextInput ref={ref} placeholderTextColor={useColors().muted} className="flex-1 text-sm text-foreground" {...rest} />
      {right}
    </View>
  );
});
/** The website's TextArea: a taller box that grows with what is typed (a message, a note). */
export const TextArea = ({ invalid, ...rest }: TextInputProps & { invalid?: boolean }) => (
  <TextInput multiline textAlignVertical="top" placeholderTextColor={useColors().muted} {...rest}
    className={`min-h-[120px] rounded-2xl border bg-surface px-4 py-3.5 text-sm leading-5 text-foreground ${invalid ? "border-danger" : "border-border"}`} />
);
