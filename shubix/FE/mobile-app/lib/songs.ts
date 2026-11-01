import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { createAudioPlayer } from "expo-audio";
import { keepFile } from "./projects";

/** A song for the Create flow (the website's Choose song and Recent songs): a file from the phone, kept in the app's
 * own folder so it is still there next time, with its length in seconds once read. */
export type Song = { uri: string; name: string; duration: number };
const KEY = "shubix.recentSongs";

export async function recentSongs(): Promise<Song[]> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || "[]") as Song[]; } catch { return []; }
}
async function remember(song: Song) {
  const list = [song, ...(await recentSongs()).filter((s) => s.uri !== song.uri)].slice(0, 8);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}
export async function forgetSong(uri: string) {
  await AsyncStorage.setItem(KEY, JSON.stringify((await recentSongs()).filter((s) => s.uri !== uri)));
  try { new File(uri).delete(); } catch { /* already gone */ }
}

/** How long a song is: read by the phone's player (0 when it cannot be read within a few seconds). */
export function songLength(uri: string): Promise<number> {
  return new Promise((resolve) => {
    const player = createAudioPlayer(uri);
    const done = (d: number) => { clearInterval(poll); clearTimeout(stop); player.remove(); resolve(d); };
    const poll = setInterval(() => { if (player.isLoaded && player.duration > 0) done(player.duration); }, 120);
    const stop = setTimeout(() => done(0), 6000);
  });
}

/** The phone's file picker (songs, or a video's sound): null when nothing was chosen. `kind`: a song or a video. */
export async function pickSong(kind: "audio" | "video" = "audio"): Promise<Song | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: kind === "video" ? ["video/*"] : ["audio/*", "video/*"], copyToCacheDirectory: true });
  if (r.canceled || !r.assets[0]) return null;
  const file = r.assets[0], uri = await keepFile(file.uri, "songs", `${Date.now()}-${file.name}`);
  const song = { uri, name: file.name.replace(/\.[^.]+$/, ""), duration: await songLength(uri) };
  if (kind === "audio") await remember(song);
  return song;
}
