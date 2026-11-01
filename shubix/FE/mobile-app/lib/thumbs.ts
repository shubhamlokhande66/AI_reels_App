import { useEffect, useState } from "react";
import { getThumbnailAsync } from "expo-video-thumbnails";

const made = new Map<string, Promise<string | null>>();
/** A picture of a video (its frame at `at` seconds) to show for it, made once per video; a photo is its own picture.
 * null while it is made, or when it cannot be. */
export function useThumb(uri: string | undefined, kind: "video" | "image" = "video", at = 0.5): string | null {
  const [thumb, setThumb] = useState<string | null>(kind === "image" ? uri ?? null : null);
  useEffect(() => {
    if (!uri || kind === "image") { setThumb(uri ?? null); return; }
    let live = true;
    if (!made.has(uri)) made.set(uri, getThumbnailAsync(uri, { time: Math.round(at * 1000), quality: 0.6 }).then((t) => t.uri).catch(() => null));
    void made.get(uri)!.then((t) => live && setThumb(t));
    return () => { live = false; };
  }, [uri, kind, at]);
  return thumb;
}

/** The drafts' pictures (their first shot), by draft id, for a list of them. */
export function useDraftThumbs(drafts: { id: string; clips: { uri: string; kind: "video" | "image" }[] }[] | null) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const key = drafts?.map((d) => d.id + (d.clips[0]?.uri ?? "")).join("|") ?? "";
  useEffect(() => {
    let live = true;
    for (const d of drafts ?? []) {
      const c = d.clips[0];
      if (!c) continue;
      if (c.kind === "image") { setThumbs((t) => ({ ...t, [d.id]: c.uri })); continue; }
      if (!made.has(c.uri)) made.set(c.uri, getThumbnailAsync(c.uri, { time: 500, quality: 0.6 }).then((t) => t.uri).catch(() => null));
      void made.get(c.uri)!.then((t) => { if (live && t) setThumbs((x) => ({ ...x, [d.id]: t })); });
    }
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return thumbs;
}
