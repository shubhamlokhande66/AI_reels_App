import { useEffect, useState, type ReactNode } from "react";
import { BackHandler, Platform, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, useText } from "@shubix/hooks";
import { FeedbackHost } from "@shubix/ui-mobile";
import { AUTH_PAGES, PUBLIC_PAGES, showTabs } from "@shubix/core/lib/nav";
import { TopBar } from "../organisms/TopBar";
import { BottomNav } from "../organisms/BottomNav";
import { MenuDrawer } from "../organisms/MenuDrawer";
import { HelpChat } from "../organisms/HelpChat";
import { useNotes } from "../../lib/notify";

/** The website's phone frame (FE/web-app/components/templates/AppShell.tsx): the top bar, the page, the bottom bar
 * (not in the studio: /create and /editor keep the screen, as on the website) and the menu. The sign-in pages stand alone; signed out, the other pages lead to sign in. */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname(), { me } = useApi(), insets = useSafeAreaInsets(), text = useText();
  const feedback = (bottom: number) => <FeedbackHost ok={text("common.ok")} cancel={text("common.cancel")} bottom={bottom} />;
  const [menu, setMenu] = useState(false);
  const authPage = AUTH_PAGES.includes(pathname), signedOut = !!me?.authEnabled && !me.user;
  useNotes(!!me?.user);
  useEffect(() => setMenu(false), [pathname]); // a new page: the menu closes
  useEffect(() => { if (signedOut && !authPage && !PUBLIC_PAGES.includes(pathname)) router.replace("/login"); }, [signedOut, authPage, pathname]);
  useEffect(() => {
    if (!menu || Platform.OS === "web") return;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => { setMenu(false); return true; }); // Android back closes the menu
    return () => handler.remove();
  }, [menu]);
  if (authPage) return <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>{children}{feedback(16)}</View>;
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
