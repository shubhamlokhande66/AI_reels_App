import { Tabs } from "expo-router";
import { useColors } from "@shubix/ui-mobile";

/** The bottom tabs (Home, Templates, My Reels, Account) as real tabs, as phone apps have them: each stays open where it
 * was (its scroll, its lists) when another is opened, nothing loads again, and Android back goes to Home, not through
 * every tab visited. The bar itself is the app's own (components/organisms/BottomNav.tsx, in AppFrame). */
export default function TabsLayout() {
  const look = useColors();
  return <Tabs tabBar={() => null} backBehavior="firstRoute" screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: look.background } }} />;
}
