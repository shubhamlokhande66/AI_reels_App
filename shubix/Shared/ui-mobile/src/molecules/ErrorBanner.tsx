import { Text, View } from "react-native";
export const ErrorBanner = ({ message }: { message: string }) => <View accessibilityRole="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5"><Text className="text-[13px] font-semibold text-danger">{message}</Text></View>;
export const NoteBanner = ({ message }: { message: string }) => <View className="rounded-xl border border-success/40 bg-success/10 px-3 py-2.5"><Text className="text-[13px] font-semibold text-success">{message}</Text></View>;
