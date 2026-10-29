"use client";

import { useSyncExternalStore } from "react";

/** Shubix inside its phone app (Capacitor, capacitor.config.ts): what the web cannot do there. An app's web view has no
 * file download and no share sheet of its own, so the exported Reel is written to the phone (the app's cache) and handed
 * to the phone's share sheet: save it, post it to Instagram, send it on WhatsApp. On the website nothing here is used. */

type CapGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };
export const isApp = () => {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
};
const noSub = () => () => {};
/** isApp() for a component (false on the server and the first paint, then the truth: it never changes while open). */
export const useIsApp = () => useSyncExternalStore(noSub, isApp, () => false);

// base64 of a piece of the file, without the data: prefix (pieces of 3 MB: never the whole video in one string)
const PIECE = 3 * 1024 * 1024;
const b64 = (blob: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

/** Writes the file to the app's cache and opens the share sheet with it (and the caption, when given). */
export async function shareFile(blob: Blob, name: string, text = ""): Promise<boolean> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  const path = `shubix/${name.replace(/[^\w.-]+/g, "_")}`;
  for (let at = 0; at < blob.size || at === 0; at += PIECE) {
    const data = await b64(blob.slice(at, at + PIECE));
    if (at === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    if (blob.size === 0) break;
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title: name, text: text || undefined, files: [uri], dialogTitle: "Save or share your Reel" });
    return true;
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) return false;
    throw e;
  }
}
