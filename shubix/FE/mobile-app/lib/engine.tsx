import { useRef } from "react";
import { Platform, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { File } from "expo-file-system";
import { ENGINE_PAGE } from "./engine.page";

/** The website's edit engine on this phone: its modules (Shared/core/src/engine/studio) run in a hidden page in the
 * phone's browser engine, as fast as the website and with the same results; the screens stay native. <EngineHost/> (in
 * the app's frame) holds the page; engine.song(uri) and the rest ask it and wait for the answer.
 * TODO (later): the same engine in Kotlin, without the hidden page. */
export type SongAnalysis = { duration: number; sampleRate: number; bpm: number; beats: number[]; cuts: number[]; cutType: ("drop" | "hit" | "cut" | "break")[]; drops: number; breaks: number; source: string };

type Waiting = { resolve: (v: unknown) => void; reject: (e: Error) => void };
const waiting = new Map<number, Waiting>();
type Page = { injectJavaScript: (js: string) => void; reload: () => void };
let page: Page | null = null, next = 1, ready: () => void;
const isReady = new Promise<void>((r) => { ready = r; });
const PART = 256 * 1024; // a big file crosses in pieces

async function call<T>(op: string, args: Record<string, unknown> = {}, audio?: string): Promise<T> {
  if (Platform.OS === "web") throw new Error("The phone's engine runs on a phone.");
  await isReady;
  const id = next++;
  if (audio) for (let i = 0; i < audio.length; i += PART) page?.injectJavaScript(`window.engine.part(${id}, ${JSON.stringify(audio.slice(i, i + PART))}); true;`);
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    page?.injectJavaScript(`window.engine.call(${id}, ${JSON.stringify(op)}, ${JSON.stringify(audio ? { ...args, audio: "@parts" } : args)}); true;`);
  });
}

export const engine = {
  /** the song as the website hears it: its beats, cuts and their kinds (drops, hits, breaks), its tempo */
  song: async (uri: string) => call<SongAnalysis>("song", {}, await new File(uri).base64()),
};

function onMessage(e: WebViewMessageEvent) {
  const m = JSON.parse(e.nativeEvent.data) as { id: number; ok: boolean; result?: unknown; error?: string };
  if (m.id === 0) return ready();
  const w = waiting.get(m.id);
  if (!w) return;
  waiting.delete(m.id);
  if (m.ok) w.resolve(m.result); else w.reject(new Error(m.error));
}

/** The hidden page (0 × 0, never seen): mounted once in the app's frame. */
export function EngineHost() {
  const ref = useRef<Page | null>(null);
  // the page was stopped by the phone (out of memory): what it was doing fails, and it starts again
  const restart = () => { waiting.forEach((w) => w.reject(new Error("The phone stopped the engine. Please try again."))); waiting.clear(); ref.current?.reload(); };
  if (Platform.OS === "web") return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}>
      <WebView ref={(w: Page | null) => { ref.current = w; page = w; }} source={{ html: ENGINE_PAGE }} originWhitelist={["*"]} onMessage={onMessage} javaScriptEnabled
        mediaPlaybackRequiresUserAction={false} onContentProcessDidTerminate={restart} onRenderProcessGone={restart} />
    </View>
  );
}
