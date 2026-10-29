import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useStudioText } from "@shubix/hooks";
import { Bubble, ChatChip, Gold, Icon, useColors } from "@shubix/ui-mobile";

// the ideas under the box (the website's askchips): what is shown, and what it says
const IDEAS: [string, string][] = [["Fast & energetic", "Fast cuts on every beat, high energy"], ["Calm & cinematic", "Make it calm and cinematic, slower cuts"], ["Zoom on the drop", "Zoom in on the drop and add camera moves on the beats"], ["Slow-mo ending", "Slow motion on the best moment at the end"]];

/** Ask Shubix AI (the website's studio askbar): a card that opens to a box where you say how you want your Reel, the
 * ideas to tap, and the conversation. `onAsk` does what was asked and returns the answer. */
export function AskShubix({ onAsk }: { onAsk: (text: string) => string | Promise<string> }) {
  const words = useStudioText(), look = useColors();
  const [open, setOpen] = useState(false), [said, setSaid] = useState(""), [log, setLog] = useState<{ me: boolean; text: string }[]>([]), [busy, setBusy] = useState(false);
  async function ask(text: string) {
    text = text.trim().slice(0, 300);
    if (!text || busy) return;
    setSaid(""); setLog((l) => [...l, { me: true, text }]); setBusy(true);
    try { const answer = await onAsk(text); setLog((l) => [...l, { me: false, text: answer }]); } finally { setBusy(false); }
  }
  return (
    <View className="overflow-hidden rounded-[18px] border border-accent/25 bg-surface">
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} className="flex-row items-center gap-3 p-3.5">
        <View className="h-10 w-10 items-center justify-center overflow-hidden rounded-full"><Gold /><Icon name="sparkle" size={18} color="#fff" /></View>
        <View className="min-w-0 flex-1">
          <Text className="text-[14.5px] font-bold text-foreground">{words("Ask Shubix")} <Text className="text-accent">AI</Text></Text>
          <Text numberOfLines={open ? undefined : 2} className="text-[12px] leading-[17px] text-muted">{words("Say how you want your Reel: the pace, the moments, zooms, transitions, slow-mo, text… Shubix edits it for you.")}</Text>
        </View>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}><Icon name="down" size={20} color="muted" /></View>
      </Pressable>
      {open && (
        <View className="gap-3 border-t border-border px-3.5 pb-3.5 pt-3">
          {log.map((m, i) => <Bubble key={i} mine={m.me}>{m.text}</Bubble>)}
          <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-surface-2 pl-3.5 pr-1.5">
            <TextInput value={said} onChangeText={setSaid} onSubmitEditing={() => void ask(said)} returnKeyType="send" maxLength={300} placeholder={words("e.g. Fast cuts, zoom on the drop")} placeholderTextColor={look.muted} className="h-11 flex-1 text-[14px] text-foreground" />
            <Pressable onPress={() => void ask(said)} disabled={!said.trim() || busy} accessibilityLabel={words("Ask Shubix")} className={`h-9 w-9 items-center justify-center overflow-hidden rounded-full ${!said.trim() || busy ? "opacity-40" : ""}`}><Gold /><Icon name="arrow" size={17} color="onAccent" /></Pressable>
          </View>
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text className="text-[12px] text-muted">{words("Try:")}</Text>
            {IDEAS.map(([label, say]) => <ChatChip key={label} label={words(label)} onPress={() => void ask(words(say))} />)}
          </View>
        </View>
      )}
    </View>
  );
}

/** What the phone can do from your words itself (the website's chatLocal, when Shubix AI is not on): the Fast or the
 * Smooth style. Returns which it used ("" when none). */
export function styleFromWords(text: string): "fast" | "smooth" | "" {
  const x = text.toLowerCase(), has = (...w: string[]) => w.some((k) => x.includes(k));
  if (has("faster", "fast", "energetic", "energy", "jalad", "जलद", "speed up", "quick")) return "fast";
  if (has("calm", "slow", "smooth", "cinematic", "halu", "हळू", "shant", "शांत")) return "smooth";
  return "";
}
