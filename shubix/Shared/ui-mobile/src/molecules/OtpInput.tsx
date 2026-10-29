import { useRef, useState, type ComponentRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

/** The website's six boxes for a one-time code (components/molecules/OtpInput.tsx): one hidden box takes the typing,
 * so the keyboard's code suggestion (from Messages / Mail) fills them all; the box being typed in is gold.
 * `onComplete` runs when the sixth digit is in. */
export function OtpInput({ value, onChange, onComplete, invalid = false, disabled = false, label }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; invalid?: boolean; disabled?: boolean; label: string }) {
  const input = useRef<ComponentRef<typeof TextInput>>(null), [focused, setFocused] = useState(false);
  const set = (typed: string) => { const v = typed.replace(/\D/g, "").slice(0, 6); onChange(v); if (v.length === 6) onComplete?.(v); };
  return (
    <Pressable onPress={() => input.current?.focus()} disabled={disabled} accessibilityLabel={label} className={disabled ? "opacity-60" : ""}>
      <View className="flex-row justify-between gap-1.5">
        {Array.from({ length: 6 }, (_, i) => {
          const now = focused && (i === value.length || (i === 5 && value.length === 6));
          return (
            <View key={i} className={`h-12 min-w-0 flex-1 items-center justify-center rounded-xl border bg-surface ${invalid ? "border-danger" : now ? "border-accent" : "border-border"}`}>
              <Text className="text-[22px] font-semibold text-foreground">{value[i] ?? ""}</Text>
            </View>
          );
        })}
      </View>
      <TextInput ref={input} value={value} onChangeText={set} editable={!disabled} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} caretHidden className="absolute inset-0 opacity-0" />
    </Pressable>
  );
}
