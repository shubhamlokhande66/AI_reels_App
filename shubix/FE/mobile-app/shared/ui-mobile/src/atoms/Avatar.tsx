import { Text, View } from "react-native";
import { Gold } from "./Gold";

/** A person's first letter on the gold gradient (the website's components/atoms/Avatar.tsx: the menu, the account). */
export function Avatar({ email, size = 36 }: { email?: string | null; size?: number }) {
  return (
    <View className="items-center justify-center overflow-hidden rounded-full" style={{ width: size, height: size }}>
      <Gold />
      <Text className="font-extrabold text-on-accent" style={{ fontSize: size * 0.42 }}>{(email?.[0] ?? "R").toUpperCase()}</Text>
    </View>
  );
}
