import { useState } from "react";
import { Pressable, type TextInputProps } from "react-native";
import { Icon } from "../atoms/Icon";
import { Input } from "../atoms/Input";
/** A password box with the eye: show / hide what is typed. */
export function PasswordInput({ invalid, showLabel = "Show password", hideLabel = "Hide password", ...rest }: TextInputProps & { invalid?: boolean; showLabel?: string; hideLabel?: string }) {
  const [show, setShow] = useState(false);
  return <Input secureTextEntry={!show} invalid={invalid} icon={<Icon name="lock" size={17} color="muted" />}
    right={<Pressable accessibilityLabel={show ? hideLabel : showLabel} onPress={() => setShow(!show)} hitSlop={8}><Icon name={show ? "eyeOff" : "eye"} size={18} color="muted" /></Pressable>} {...rest} />;
}
