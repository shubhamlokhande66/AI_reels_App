import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import type { ImagePickerAsset } from "expo-image-picker";
import { clipSchema, projectSchema, type ProjectClip, type ReelProject } from "@mobile/validations";

const KEY = "shubix.mobile.projects.v1";
export type MobileProject = ReelProject;
const read = async (): Promise<MobileProject[]> => { try { return JSON.parse(await AsyncStorage.getItem(KEY) || "[]") as MobileProject[]; } catch { return []; } };
export async function listProjects() { return read(); }
export async function getProject(id: string) { return (await read()).find((p) => p.id === id) || null; }
export async function saveProject(project: MobileProject) { const parsed = projectSchema.safeParse(project); if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "This Reel draft could not be saved."); const items = await read(), next = [parsed.data, ...items.filter((x) => x.id !== project.id)].slice(0, 40); await AsyncStorage.setItem(KEY, JSON.stringify(next)); }
export async function removeProject(id: string) { const items = await read(); await AsyncStorage.setItem(KEY, JSON.stringify(items.filter((x) => x.id !== id))); }

/** A picked file kept in the app's own folder (`folder` under its documents), so it is still there after the picker's
 * permission ends; the same name again replaces it. Returns its new address, or where it is when the phone does not let
 * the app copy it (Expo Go: the pickers' cache is Expo Go's, readable to play but not to copy). */
export async function keepFile(from: string, folder: string, name: string): Promise<string> {
  try {
    const dir = new Directory(Paths.document, ...folder.split("/"));
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const to = new File(dir, name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90) || "file");
    await new File(from).copy(to, { overwrite: true });
    return to.uri;
  } catch (e) {
    console.warn("Kept where it was picked:", e instanceof Error ? e.message : e);
    return from;
  }
}

/** Copy picker URIs into app-private storage so Android's temporary photo-picker grant survives reloads. */
export async function keepPickedAssets(id: string, assets: ImagePickerAsset[], onEach?: (done: number) => void): Promise<ProjectClip[]> {
  let done = 0; // `onEach`: how many are copied so far
  return Promise.all(assets.map(async (asset, index) => {
    const original = asset.fileName || `moment-${index + 1}.${asset.type === "image" ? "jpg" : "mp4"}`;
    const uri = await keepFile(asset.uri, `projects/${id}`, `${index + 1}-${original}`);
    onEach?.(++done);
    const sourceDuration = asset.type === "image" ? 5 : Math.max(0.5, (asset.duration || 5000) / 1000);
    return clipSchema.parse({ id: `${id}-clip-${index + 1}`, uri, name: original, kind: asset.type === "image" ? "image" : "video", duration: sourceDuration, sourceDuration, start: 0, end: sourceDuration, speed: 1, reverse: false, muted: false, volume: 1, filter: "Original", transition: "Cut", rotation: 0, mirror: false, flip: false, fit: "cover" });
  }));
}

export const keepPickedFile = (projectId: string, from: string, name: string) => keepFile(from, `projects/${projectId}`, `audio-${name}`);
