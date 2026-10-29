import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Search, Sparkles } from "lucide-react-native";
import { Eyebrow, H1, Page, SectionTitle, Surface, colors } from "@shubix/ui-mobile";
import { mobileApi } from "../../lib/api";

const tileColors = ["#594a30", "#30353c", "#443d48", "#35453e", "#51403b", "#41403d"];
export default function TemplatesScreen() {
  const [term, setTerm] = useState("");
  const q = useQuery({ queryKey: ["native-templates"], queryFn: mobileApi.templates });
  const list = useMemo(() => (q.data?.templates || []).filter(x => x.on && `${x.name} ${x.group} ${x.text}`.toLowerCase().includes(term.toLowerCase())), [q.data, term]);
  return <Page><View className="mt-3"><Eyebrow>THE SHUBIX EDIT</Eyebrow><H1>Templates</H1><Text className="mt-2 text-sm leading-6 text-muted">A considered starting point for every kind of story.</Text></View>
    <View className="mt-5 flex-row items-center rounded-2xl border border-border bg-surface px-4 py-3.5"><Search size={17} color={colors.muted}/><TextInput value={term} onChangeText={setTerm} placeholder="Find a look or a mood" placeholderTextColor={colors.muted} className="ml-3 flex-1 text-sm text-foreground"/></View>
    {q.isLoading ? <View className="mt-10 items-center"><ActivityIndicator color={colors.accent}/><Text className="mt-3 text-xs text-muted">Curating your templates…</Text></View> : q.isError ? <Surface className="mt-5"><Text className="text-sm text-muted">Templates are temporarily unavailable. Please try again in a moment.</Text></Surface> : list.length ? <><SectionTitle title={`${list.length} looks to explore`}/><View className="flex-row flex-wrap justify-between">{list.map((item, i) => <Pressable key={item.id} onPress={() => router.push({ pathname: "/create", params: { templateId: item.id, kind: item.kind } })} className="mb-3 w-[48%]"><View className="h-52 overflow-hidden rounded-2xl border border-border p-3" style={{ backgroundColor: tileColors[i % tileColors.length] }}><View className="absolute right-3 top-3 h-32 w-20 rotate-6 rounded-2xl border border-white/10 bg-white/5"/><View className="absolute bottom-3 left-3 right-3"><Eyebrow>{item.group || "THE SHUBIX EDIT"}</Eyebrow><Text numberOfLines={1} className="mt-1 text-base font-semibold text-foreground">{item.name}</Text><Text numberOfLines={2} className="mt-1 text-[10px] leading-4 text-white/70">{item.text}</Text></View></View></Pressable>)}</View></> : <Surface className="mt-5"><Text className="text-sm font-semibold text-foreground">No templates found</Text><Text className="mt-1 text-xs text-muted">Try another name or mood.</Text></Surface>}
    <Surface className="mt-2"><View className="flex-row items-center gap-3"><Sparkles size={18} color={colors.accent}/><View className="flex-1"><Text className="text-sm font-semibold text-foreground">Your brand, your signature</Text><Text className="mt-1 text-xs text-muted">Save your favorite colors and styles.</Text></View></View></Surface>
  </Page>;
}
