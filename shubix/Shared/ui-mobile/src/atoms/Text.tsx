import type { ReactNode } from "react";
import { Text } from "react-native";
export const Eyebrow = ({ children }: { children: ReactNode }) => <Text className="text-[10px] font-bold uppercase tracking-[2px] text-accent">{children}</Text>;
export const H1 = ({ children }: { children: ReactNode }) => <Text className="mt-2 text-[30px] font-semibold leading-[36px] text-foreground">{children}</Text>;
export const Muted = ({ children, className = "" }: { children: ReactNode; className?: string }) => <Text className={`text-sm leading-6 text-muted ${className}`}>{children}</Text>;
export const Label = ({ children }: { children: ReactNode }) => <Text className="mb-2 text-xs font-semibold text-foreground">{children}</Text>;
