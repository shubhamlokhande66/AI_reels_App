import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useQuery } from "@tanstack/react-query";
import { mobileApi } from "./api";

/** The phone's own notifications: the administrator's new messages (the bell's, Admin → Messages) and a Reel exported
 * while the app was away. A tap opens the message's page. Asked for once (Android 13+), never before something to say. */
const web = Platform.OS === "web", SEEN = "shubix.notes.told";
if (!web) Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });

async function allowed() {
  if (web) return false;
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Shubix", importance: Notifications.AndroidImportance.DEFAULT });
  const now = await Notifications.getPermissionsAsync();
  return now.granted || (now.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
}
/** A notification now, when the creator allows them (`link`: the app's page a tap opens). */
export async function notify(title: string, body: string, link?: string) {
  try { if (await allowed()) await Notifications.scheduleNotificationAsync({ content: { title, body, data: link ? { link } : {} }, trigger: null }); } catch { /* not on this phone */ }
}
/** Only while the app is not on screen (a Reel finished in the background). */
export const notifyAway = (title: string, body: string, link?: string) => { if (AppState.currentState !== "active") void notify(title, body, link); };

/** In the app's frame: a tap on a notification opens its page; the bell's new messages told once each. */
export function useNotes(signedIn: boolean) {
  const notes = useQuery({ queryKey: ["notifications"], queryFn: mobileApi.notifications, enabled: signedIn && !web, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false });
  useEffect(() => {
    if (web) return;
    const open = (r: Notifications.NotificationResponse | null) => { const link = r?.notification.request.content.data?.link; if (typeof link === "string" && link.startsWith("/")) router.push(link as never); };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const fresh = notes.data?.items.filter((m) => m.unread) ?? [];
    if (!fresh.length) return;
    void (async () => {
      const told = new Set((await SecureStore.getItemAsync(SEEN))?.split(",") ?? []);
      const news = fresh.filter((m) => !told.has(m.id));
      for (const m of news) await notify(m.title, m.body, m.link.startsWith("/") ? m.link : undefined);
      if (news.length) await SecureStore.setItemAsync(SEEN, [...told, ...news.map((m) => m.id)].slice(-50).join(","));
    })().catch(() => {});
  }, [notes.data]);
}
