import { useEffect, useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useText } from "@shubix/hooks";
import { Bubble, Button, ChatChip, Gold, Icon, ThemeLayer, Typing, useColors } from "@shubix/ui-mobile";
import { errorMessage } from "@shubix/api-client";
import { mobileApi } from "../../lib/api";

type Msg = { role: "user" | "assistant"; content: string; human?: boolean; suggestions?: string[] };
let kept: Msg[] = []; // the conversation while the app is open (the website keeps it for the tab)
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[(.+?)\]\((.+?)\)/g, "$1"); // the answers' markdown, as words

/** The Help chat (the website's components/organisms/HelpChat.tsx; Admin → Support turns it on): a round button above
 * the bottom bar on every page (not in the studio), a chat that answers questions about Shubix, and the way to the team
 * when a person is needed. Every word: Admin → CMS → Every page → Help chat. */
export function HelpChat({ pathname, bottom }: { pathname: string; bottom: number }) {
  const text = useText(), look = useColors(), insets = useSafeAreaInsets();
  const on = useQuery({ queryKey: ["help-on"], queryFn: mobileApi.helpOn, staleTime: 600_000, retry: false }).data?.on;
  const [open, setOpen] = useState(false), [msgs, setMsgs] = useState<Msg[]>(kept), [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), list = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { kept = msgs; setTimeout(() => list.current?.scrollToEnd({ animated: true }), 60); }, [msgs, busy, open]);
  if (!on || pathname.startsWith("/create") || pathname.startsWith("/editor")) return null;

  const ask = async (q: string) => {
    const content = q.trim().slice(0, 1200);
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next); setQuestion(""); setError(null); setBusy(true);
    try { const r = await mobileApi.help(next.slice(-10).map(({ role, content: c }) => ({ role, content: c })), pathname); setMsgs([...next, { role: "assistant", content: r.answer, human: r.needsHuman, suggestions: r.suggestions }]); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const lastQuestion = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "", last = msgs[msgs.length - 1];
  const starters = [text("help.q1"), text("help.q2"), text("help.q3"), text("help.q4")].filter(Boolean);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityLabel={text("help.open")} className="absolute right-4 z-30 h-12 w-12 items-center justify-center overflow-hidden rounded-full shadow-lg shadow-black/30" style={{ bottom: bottom + insets.bottom }}>
        <Gold /><Icon name="chat" size={20} color="onAccent" />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <ThemeLayer className="justify-end bg-black/40">
          <Pressable className="flex-1" onPress={() => setOpen(false)} accessibilityLabel={text("help.close")} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View className="mx-3 max-h-[620px] overflow-hidden rounded-3xl border border-border bg-background" style={{ marginBottom: 12 + insets.bottom }}>
              <View className="flex-row items-center gap-3 px-4 py-3.5">
                <LinearGradient colors={["#29271f", "#191917", "#393326"]} locations={[0, 0.62, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: "absolute", inset: 0 }} />
                <View className="h-9 w-9 items-center justify-center rounded-full bg-white/15"><Icon name="sparkle" size={18} color="#fff" /></View>
                <View className="min-w-0 flex-1"><Text className="text-[14.5px] font-bold text-white">{text("help.title")}</Text><Text className="text-[11.5px] text-white/70">{text("help.sub")}</Text></View>
                {msgs.length > 0 && <Pressable onPress={() => { setMsgs([]); setError(null); }} className="rounded-full px-2 py-1"><Text className="text-[11.5px] text-white/75">{text("help.clear")}</Text></Pressable>}
                <Pressable onPress={() => setOpen(false)} accessibilityLabel={text("help.close")} className="h-8 w-8 items-center justify-center rounded-full"><Icon name="close" size={18} color="#fff" /></Pressable>
              </View>
              <ScrollView ref={list} className="min-h-[220px] bg-surface-2/40" contentContainerClassName="gap-2.5 px-3.5 py-4" keyboardShouldPersistTaps="handled">
                <Bubble>{plain(text("help.welcome"))}</Bubble>
                {!msgs.length && <View className="flex-row flex-wrap gap-1.5 pt-1">{starters.map((q) => <ChatChip key={q} label={q} onPress={() => void ask(q)} />)}</View>}
                {msgs.map((m, i) => (
                  <Bubble key={i} mine={m.role === "user"}>
                    {m.role === "user" ? m.content : (
                      <View className="gap-2">
                        <Text className="text-[13.5px] leading-5 text-foreground">{plain(m.content)}</Text>
                        {m.human && <Button size="sm" variant="secondary" icon="mail" title={text("help.contact")} onPress={() => { setOpen(false); router.push({ pathname: "/contact", params: { topic: "other", message: lastQuestion } }); }} />}
                      </View>
                    )}
                  </Bubble>
                ))}
                {busy && <Typing label={text("help.thinking")} />}
                {!busy && last?.role === "assistant" && !!last.suggestions?.length && <View className="flex-row flex-wrap gap-1.5">{last.suggestions.map((q) => <ChatChip key={q} label={q} onPress={() => void ask(q)} />)}</View>}
                {error ? <Text className="rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</Text> : null}
              </ScrollView>
              <View className="flex-row items-end gap-2 border-t border-border bg-background p-2.5">
                <TextInput value={question} onChangeText={setQuestion} multiline maxLength={1200} placeholder={text("help.placeholder")} placeholderTextColor={look.muted}
                  className="max-h-28 min-h-[42px] flex-1 rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[14px] text-foreground" />
                <Pressable onPress={() => void ask(question)} disabled={!question.trim() || busy} accessibilityLabel={text("help.send")} className={`h-[42px] w-[42px] items-center justify-center overflow-hidden rounded-full ${!question.trim() || busy ? "opacity-40" : ""}`}>
                  <Gold /><Icon name="send" size={18} color="onAccent" />
                </Pressable>
              </View>
              <Text className="bg-background px-4 pb-2.5 text-center text-[10.5px] text-muted">{text("help.footer")}</Text>
            </View>
          </KeyboardAvoidingView>
        </ThemeLayer>
      </Modal>
    </>
  );
}
