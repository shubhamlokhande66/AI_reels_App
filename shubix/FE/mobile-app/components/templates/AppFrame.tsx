import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Platform, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, useText } from "@shubix/hooks";
import { Button, FeedbackHost, TaskHost, colors } from "@shubix/ui-mobile";
import { tokenStore } from "../../lib/device";
import { AUTH_PAGES, PUBLIC_PAGES, showTabs } from "@shubix/core/lib/nav";
import { TopBar } from "../organisms/TopBar";
import { BottomNav } from "../organisms/BottomNav";
import { MenuDrawer } from "../organisms/MenuDrawer";
import { HelpChat } from "../organisms/HelpChat";
import { useNotes } from "../../lib/notify";

/** The website's phone frame (FE/web-app/components/templates/AppShell.tsx): the top bar, the page, the bottom bar
 * (not in the studio: /create and /editor keep the screen, as on the website) and the menu. The sign-in pages stand alone; signed out, the other pages lead to sign in. */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname(), { me, refresh } = useApi(), insets = useSafeAreaInsets(), text = useText();
  const feedback = (bottom: number) => <><TaskHost bottom={bottom + 8} /><FeedbackHost ok={text("common.ok")} cancel={text("common.cancel")} bottom={bottom} /></>;
  const [menu, setMenu] = useState(false), [noToken, setNoToken] = useState(false), [slow, setSlow] = useState(false);
  const authPage = AUTH_PAGES.includes(pathname), open = authPage || PUBLIC_PAGES.includes(pathname);
  // who is signed in is not known yet: no token on this phone means signed out at once; with one, the app waits for the
  // server (a sleeping server wakes in 20-30 s) and offers to try again when it takes too long
  const unknown = me === null && !open, signedOut = (!!me?.authEnabled && !me.user) || (me === null && noToken);
  useNotes(!!me?.user);
  useEffect(() => { if (me === null) void tokenStore.get().then((t) => setNoToken(!t)); }, [me]);
  useEffect(() => { setSlow(false); if (!unknown) return; const t = setTimeout(() => setSlow(true), 40_000); return () => clearTimeout(t); }, [unknown]);
  useEffect(() => setMenu(false), [pathname]); // a new page: the menu closes
  useEffect(() => { if (signedOut && !open) router.replace("/login"); }, [signedOut, open]);
  useEffect(() => {
    if (!menu || Platform.OS === "web") return;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => { setMenu(false); return true; }); // Android back closes the menu
    return () => handler.remove();
  }, [menu]);
  if (authPage) return <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>{children}{feedback(16)}</View>;
  if (unknown) return (
    <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
      <ActivityIndicator color={colors.accent} />
      <Text className="text-center text-[13px] text-muted">{text(slow ? "common.offline" : "common.connecting")}</Text>
      {slow && <Button title={text("common.retry")} onPress={() => void refresh()} />}
    </View>
  );
  return (
    <View className="flex-1 bg-background">
      <TopBar pathname={pathname} onMenu={() => setMenu(true)} />
      <View className="flex-1">{children}</View>
      {showTabs(pathname) && <BottomNav pathname={pathname} />}
      <MenuDrawer open={menu} onClose={() => setMenu(false)} pathname={pathname} />
      <HelpChat pathname={pathname} bottom={showTabs(pathname) ? 84 : 16} />
      {feedback(showTabs(pathname) ? 88 : 84)}
    </View>
  );
}
