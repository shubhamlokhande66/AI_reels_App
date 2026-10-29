import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiProvider } from "@shubix/hooks";
import { colors } from "@shubix/ui-mobile";
import { api } from "../lib/session";

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 45_000, retry: 1 } } }));
  return <SafeAreaProvider><ApiProvider api={api}><QueryClientProvider client={client}><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: "fade_from_bottom" }}><Stack.Screen name="(tabs)" /><Stack.Screen name="create/index" options={{ presentation: "modal", animation: "slide_from_bottom" }} /><Stack.Screen name="editor/[id]" options={{ animation: "slide_from_right" }} /><Stack.Screen name="auth/sign-in" options={{ presentation: "modal" }} /><Stack.Screen name="auth/sign-up" options={{ presentation: "modal" }} /></Stack></QueryClientProvider></ApiProvider></SafeAreaProvider>;
}
