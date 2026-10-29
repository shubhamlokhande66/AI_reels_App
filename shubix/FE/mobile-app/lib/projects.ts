import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import type { ImagePickerAsset } from "expo-image-picker";
import { clipSchema, projectSchema, type ProjectClip, type ReelProject } from "@shubix/validations";

const KEY = "shubix.mobile.projects.v1";
export type MobileProject = ReelProject;
const read = async (): Promise<MobileProject[]> => { try { return JSON.parse(await AsyncStorage.getItem(KEY) || "[]") as MobileProject[]; } catch { return []; } };
export async function listProjects() { return read(); }
export async function getProject(id: string) { return (await read()).find((p) => p.id === id) || null; }
export async function saveProject(project: MobileProject) { const parsed = projectSchema.safeParse(project); if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "This Reel draft could not be saved."); const items = await read(), next = [parsed.data, ...items.filter((x) => x.id !== project.id)].slice(0, 40); await AsyncStorage.setItem(KEY, JSON.stringify(next)); }
export async function removeProject(id: string) { const items = await read(); await AsyncStorage.setItem(KEY, JSON.stringify(items.filter((x) => x.id !== id))); }

/** Copy picker URIs into app-private storage so Android's temporary photo-picker grant survives reloads. */
export async function keepPickedAssets(id: string, assets: ImagePickerAsset[], onEach?: (done: number) => void): Promise<ProjectClip[]> {
  const dir = `${FileSystem.documentDirectory}projects/${id}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  let done = 0; // `onEach`: how many are copied so far
  return Promise.all(assets.map(async (asset, index) => {
    const original = asset.fileName || `moment-${index + 1}.${asset.type === "image" ? "jpg" : "mp4"}`;
    const safe = original.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90);
    const uri = `${dir}${index + 1}-${safe}`;
    await FileSystem.copyAsync({ from: asset.uri, to: uri });
    onEach?.(++done);
    const sourceDuration = asset.type === "image" ? 5 : Math.max(0.5, (asset.duration || 5000) / 1000);
    return clipSchema.parse({ id: `${id}-clip-${index + 1}`, uri, name: original, kind: asset.type === "image" ? "image" : "video", duration: sourceDuration, sourceDuration, start: 0, end: sourceDuration, speed: 1, reverse: false, muted: false, volume: 1, filter: "Original", transition: "Cut", rotation: 0, mirror: false, flip: false, fit: "cover" });
  }));
}

export async function keepPickedFile(projectId: string, from: string, name: string) {
  const dir = `${FileSystem.documentDirectory}projects/${projectId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90) || "audio.mp3";
  const uri = `${dir}audio-${safe}`;
  await FileSystem.copyAsync({ from, to: uri });
  return uri;
}
