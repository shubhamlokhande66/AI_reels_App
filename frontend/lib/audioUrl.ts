/** Playing a song the person picked, before (or without) the server: the browser labels a file by its name, and a
 * WhatsApp ".mpeg" song (an MP3 inside) comes out as video/mpeg, which an audio player refuses. The file is given the
 * audio type its name means, so it plays. (The server does the same from the file's content: api/projects.playable_audio.) */

const BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg", mpeg: "audio/mpeg", mpg: "audio/mpeg", mpga: "audio/mpeg", mp2: "audio/mpeg",
  m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  wav: "audio/wav", flac: "audio/flac", webm: "audio/webm",
};
/** Formats no browser plays (voice-note codecs): play the server's MP3 copy instead. */
export const UNPLAYABLE = new Set(["amr", "awb", "wma", "3gp", "3ga", "ac3", "aiff", "aif", "caf"]);

export function extOf(file: File): string {
  return (file.name.toLowerCase().split(".").pop() ?? "").trim();
}

/** The audio type a picked song should be played as (null: the browser's own label is fine). */
export function audioType(file: File): string | null {
  const ext = extOf(file);
  if (file.type.startsWith("audio/") && BY_EXT[ext] === undefined) return null;
  return BY_EXT[ext] ?? (file.type.startsWith("video/") ? "audio/mpeg" : null);
}

/** A URL that plays the song (remember to URL.revokeObjectURL it). */
export function audioBlobUrl(file: File): string {
  const type = audioType(file);
  return URL.createObjectURL(type && type !== file.type ? new Blob([file], { type }) : file);
}

/** True when the browser cannot play this song itself (the server's MP3 copy is needed). */
export function needsServerCopy(file: File): boolean {
  return UNPLAYABLE.has(extOf(file));
}
