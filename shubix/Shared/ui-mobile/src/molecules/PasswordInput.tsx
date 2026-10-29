import { useState } from "react";
import { Pressable, type TextInputProps } from "react-native";
import { Eye, EyeOff, LockKeyhole } from "lucide-react-native";
import { Input } from "../atoms/Input";
import { colors } from "../colors";
/** A password box with the eye: show / hide what is typed. */
export function PasswordInput({ invalid, showLabel = "Show password", hideLabel = "Hide password", ...rest }: TextInputProps & { invalid?: boolean; showLabel?: string; hideLabel?: string }) {
  const [show, setShow] = useState(false);
  return <Input secureTextEntry={!show} invalid={invalid} icon={<LockKeyhole size={17} color={colors.muted} />}
    right={<Pressable accessibilityLabel={show ? hideLabel : showLabel} onPress={() => setShow(!show)}>{show ? <EyeOff size={17} color={colors.muted} /> : <Eye size={17} color={colors.muted} />}</Pressable>} {...rest} />;
}
