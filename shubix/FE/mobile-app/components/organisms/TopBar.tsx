import { router } from "expo-router";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, useText } from "@shubix/hooks";
import { Hairline, IconButton } from "@shubix/ui-mobile";
import { pageMeta } from "@shubix/core/lib/nav";
import { Logo } from "../atoms/Logo";
import { NotificationBell } from "../molecules/NotificationBell";

/** The website's phone top bar (AppShell): menu or back · the logo on Home, else "Shubix · Studio" and the page's
 * title · the page's own buttons. */
export function TopBar({ pathname, onMenu }: { pathname: string; onMenu: () => void }) {
  const text = useText(), insets = useSafeAreaInsets(), { me } = useApi();
  const meta = pageMeta(pathname), home = pathname === "/", back = meta.back;
  return (
    <View className="flex-row items-center gap-2 border-b border-accent/15 bg-bar/90 px-3.5 pb-2.5" style={{ paddingTop: Math.max(10, insets.top) }}>
      <Hairline />
      <View className="w-10">
        {back
          ? <IconButton icon="back" look="plain" label={text("common.back")} onPress={() => (router.canGoBack() ? router.back() : router.replace(back as never))} />
          : <IconButton icon="menu" look="plain" iconSize={22} label={text("common.openMenu")} onPress={onMenu} />}
      </View>
      <View className={`min-w-0 flex-1 ${meta.left || home ? "items-start" : "items-center"}`}>
        {home ? <Logo height={42} /> : <>
          <Text className="mb-1 text-[8px] font-extrabold uppercase tracking-[1.6px] text-accent">{text("nav.eyebrow")}</Text>
          <Text numberOfLines={1} className="text-[14px] font-semibold tracking-[-0.21px] text-foreground">{meta.tk ? text(meta.tk) : meta.title}</Text>
        </>}
      </View>
      {!!me?.user && <NotificationBell />}
    </View>
  );
}
