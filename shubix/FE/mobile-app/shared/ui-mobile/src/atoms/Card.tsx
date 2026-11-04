import type { ReactNode } from "react";
import { View } from "react-native";

/** The website's one card (components/atoms/Card.tsx): rounded 16, a hairline border, the surface colour, 16 inside. */
export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => <View className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>{children}</View>;
