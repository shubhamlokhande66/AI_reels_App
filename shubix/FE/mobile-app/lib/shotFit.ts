/** A shot keeps its place on the song, so the cuts after it stay on the beat. It needs `timeline * speed` seconds of its clip:
 * near the clip's end it starts earlier in the clip; a clip too short for it plays slower (down to the editor's lowest speed). */
export function fitShot(timeline: number, speed: number, sourceDuration: number, at: number) {
  const want = Math.max(0.1, timeline * speed);
  if (want <= sourceDuration) { const start = Math.min(Math.max(0, at), sourceDuration - want); return { start, end: start + want, speed }; }
  return { start: 0, end: sourceDuration, speed: timeline > 0 ? Math.min(speed, Math.max(0.25, sourceDuration / timeline)) : speed };
}
