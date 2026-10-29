import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { AudioLines, Clapperboard, ImagePlus, Music2, Plus, Sparkles, Video } from "lucide-react-native";
import { Alert, Pressable, Text, View } from "react-native";
import { Button, Eyebrow, H1, Page, Surface, colors } from "@shubix/ui-mobile";
import { keepPickedAssets, saveProject } from "../../lib/projects";
import type { ReelProject } from "@shubix/validations";

const modes: { key: ReelProject["kind"]; name: string; sub: string; icon: typeof Music2 }[] = [{ key: "music", name: "Music Reel", sub: "Let your soundtrack set the pace", icon: Music2 }, { key: "talking", name: "Talking Reel", sub: "Shape a story from your words", icon: AudioLines }, { key: "photo", name: "Photo Reel", sub: "Give your memories movement", icon: ImagePlus }, { key: "copy", name: "Copy a Reel", sub: "Start with a reference video", icon: Clapperboard }, { key: "story", name: "Story Maker", sub: "Turn a written idea into a visual story", icon: Sparkles }];
export default function CreateScreen() {
  const params = useLocalSearchParams<{ kind?: string; templateId?: string }>();
  const selectedKind = ["music", "talking", "photo", "copy", "story"].includes(params.kind || "") ? params.kind as ReelProject["kind"] : "music";
  const [kind, setKind] = useState<ReelProject["kind"]>(selectedKind);
  const [media, setMedia] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = useState(false);
  async function addMedia() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos", "images"], allowsMultipleSelection: true, selectionLimit: 12, quality: 0.8, videoMaxDuration: 180 });
    if (!result.canceled) setMedia((old) => [...old, ...result.assets].slice(0, 12));
  }
  async function makeReel() {
    if (!media.length) { Alert.alert("Add a few moments", "Choose at least one video or photo to start your Reel."); return; }
    setBusy(true);
    try {
      const id = `draft-${Date.now()}`;
      const clips = await keepPickedAssets(id, media);
      const project = { id, title: "Untitled Reel", kind, clips, ...(params.templateId ? { templateId: params.templateId } : {}), overlays: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "draft" as const };
      await saveProject(project);
      router.push({ pathname: "/editor/[id]", params: { id, projectId: id, kind, media: JSON.stringify(clips) } });
    } catch (e) { Alert.alert("Couldn't prepare your clips", e instanceof Error ? e.message : "Please try choosing the clips again."); }
    finally { setBusy(false); }
  }
  return <Page><View className="mt-2 flex-row items-center justify-between"><Pressable onPress={() => router.back()}><Text className="text-sm font-semibold text-muted">Cancel</Text></Pressable><View className="rounded-full border border-[#655536] bg-[#242117] px-3 py-1.5"><Text className="text-[10px] font-bold uppercase tracking-[1px] text-accent">New Reel</Text></View></View><View className="mt-6"><Eyebrow>YOUR NEXT STORY</Eyebrow><H1>Start with a feeling.</H1><Text className="mt-2 text-sm leading-6 text-muted">Choose a format and bring in the moments you want to keep.</Text></View><View className="mt-5 gap-2">{modes.map(({ key, name, sub, icon: Icon }) => <Pressable onPress={() => setKind(key)} key={key} className={`flex-row items-center gap-3 rounded-2xl border p-3.5 ${kind === key ? "border-[#8d7548] bg-[#242117]" : "border-border bg-surface"}`}><View className="h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Icon size={19} color={kind === key ? colors.accent : colors.muted}/></View><View className="flex-1"><Text className="text-sm font-semibold text-foreground">{name}</Text><Text className="mt-1 text-xs text-muted">{sub}</Text></View><View className={`h-4 w-4 items-center justify-center rounded-full border ${kind === key ? "border-accent bg-accent" : "border-[#69665d]"}`}>{kind === key && <View className="h-1.5 w-1.5 rounded-full bg-background"/>}</View></Pressable>)}</View><View className="mb-3 mt-6 flex-row items-center justify-between"><Text className="text-[16px] font-semibold text-foreground">Your moments</Text><Text className="text-xs text-muted">{media.length}/12 added</Text></View><Pressable onPress={addMedia} className="min-h-[142px] items-center justify-center rounded-[22px] border border-dashed border-[#62563b] bg-[#1c1a15]"><View className="mb-2 h-11 w-11 items-center justify-center rounded-2xl bg-[#2c281e]"><Plus size={22} color={colors.accent}/></View><Text className="text-sm font-semibold text-foreground">Add videos or photos</Text><Text className="mt-1 text-xs text-muted">Choose from your device · up to 12 clips</Text></Pressable>{media.length > 0 && <View className="mt-3 gap-2">{media.map((item, index) => <Surface key={`${item.uri}-${index}`}><View className="flex-row items-center gap-3"><View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-2">{item.type === "video" ? <Video size={17} color={colors.accent}/> : <ImagePlus size={17} color={colors.accent}/>}</View><Text numberOfLines={1} className="flex-1 text-sm text-foreground">{item.fileName || `Moment ${index + 1}`}</Text><Pressable onPress={() => setMedia((old) => old.filter((_, i) => i !== index))}><Text className="text-xs text-muted">Remove</Text></Pressable></View></Surface>)}</View>}<View className="mb-4 mt-5"><Button title={busy ? "Opening studio…" : "Continue to studio"} onPress={makeReel} icon={<Sparkles size={16} color={colors.background}/>}/></View></Page>;
}
