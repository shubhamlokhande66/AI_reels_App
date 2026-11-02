import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiProvider } from "@shubix/hooks";
import { ThemeProvider, themes } from "@shubix/ui-mobile";
import { api } from "../lib/session";
import { useThemePref } from "../lib/theme";
import { AppFrame } from "../components/templates/AppFrame";
import { EngineHost } from "../lib/engine";
import { GalleryHost } from "../components/organisms/Gallery";
import { reportErrors } from "../lib/errors";

reportErrors();

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 45_000, retry: 1 } } }));
  const look = useThemePref();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><ApiProvider api={api}><QueryClientProvider client={client}><ThemeProvider {...look}>
      <StatusBar style={look.theme === "dark" ? "light" : "dark"} />
      <AppFrame><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: themes[look.theme].background }, animation: "fade" }} /></AppFrame>
      <EngineHost />
      <GalleryHost />
    </ThemeProvider></QueryClientProvider></ApiProvider></SafeAreaProvider></GestureHandlerRootView>
  );
}
