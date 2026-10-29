import type { ReactNode } from "react";
import { Text, View } from "react-native";
/** A label, the control, then a hint, or what is wrong (red) / right (green). */
export function Field({ label, hint, error, ok, children }: { label: string; hint?: string; error?: string; ok?: string; children: ReactNode }) {
  const note = error || ok || hint;
  return <View><Text className="mb-2 text-xs font-semibold text-foreground">{label}</Text>{children}{note ? <Text className={`mt-1.5 text-xs ${error ? "font-semibold text-danger" : ok ? "font-semibold text-success" : "text-muted"}`}>{note}</Text> : null}</View>;
}
