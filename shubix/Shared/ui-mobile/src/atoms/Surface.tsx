import type { ReactNode } from "react";
import { View } from "react-native";
export function Surface({ children, className = "" }: { children: ReactNode; className?: string }) { return <View className={`rounded-2xl border border-line bg-panel p-4 ${className}`}>{children}</View>; }
