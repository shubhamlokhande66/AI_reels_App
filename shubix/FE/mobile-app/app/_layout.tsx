import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiProvider } from "@shubix/hooks";
import { colors } from "@shubix/ui-mobile";
import { api } from "../lib/session";
import { AppFrame } from "../components/templates/AppFrame";

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 45_000, retry: 1 } } }));
  return (
    <SafeAreaProvider><ApiProvider api={api}><QueryClientProvider client={client}>
      <StatusBar style="light" />
      <AppFrame><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: "fade" }} /></AppFrame>
    </QueryClientProvider></ApiProvider></SafeAreaProvider>
  );
}
