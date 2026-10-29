import { Tabs } from "expo-router";
import { House, Clapperboard, LayoutGrid, Ellipsis, Plus } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { router } from "expo-router";

const gold = "#d8bd7b";
export default function TabLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: "#151513", borderTopColor: "#302e27", height: 74, paddingTop: 8, paddingBottom: 12 }, tabBarActiveTintColor: gold, tabBarInactiveTintColor: "#888579", tabBarLabelStyle: { fontSize: 10, fontWeight: "600" } }}>
    <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
    <Tabs.Screen name="templates" options={{ title: "Templates", tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} /> }} />
    <Tabs.Screen name="create-action" options={{ title: "Create", tabBarIcon: () => <Plus color="#10100f" size={23} strokeWidth={2.5}/>, tabBarButton: (props) => <Pressable {...(props as object)} onPress={() => router.push("/create")} style={[props.style as object, { alignItems: "center", justifyContent: "center", marginTop: -16 }]}><View style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 26, borderWidth: 3, borderColor: "#10100f", backgroundColor: gold }}><Plus size={23} color="#10100f" strokeWidth={2.5}/></View></Pressable> }} />
    <Tabs.Screen name="reels" options={{ title: "My Reels", tabBarIcon: ({ color, size }) => <Clapperboard color={color} size={size} /> }} />
    <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: ({ color, size }) => <Ellipsis color={color} size={size} /> }} />
    <Tabs.Screen name="profile" options={{ href: null }} />
  </Tabs>;
}
