import { Pressable, Text } from "react-native";
/** A text-only action in the accent colour. */
export const LinkText = ({ title, onPress, className = "" }: { title: string; onPress: () => void; className?: string }) => <Pressable onPress={onPress} className={`py-1 ${className}`}><Text className="text-xs font-semibold text-champagne">{title}</Text></Pressable>;
