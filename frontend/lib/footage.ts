/** Footage vs Reel length: a Reel can only show as much real footage as the clips contain. When the clips are shorter
 * than the Reel, the app would have to slow shots down and show moments again, so the person is asked first: add
 * more clips, or make the Reel as long as the footage. */

export const MIN_REEL_SECONDS = 5;
/** The editor needs a little more good footage than the Reel lasts (it picks the best moments and never repeats one);
 * below this it would slow shots down or replay moments. Same rule as the backend (pipeline.FOOTAGE_HEADROOM). */
export const FOOTAGE_HEADROOM = 1.15;

export interface FootageCheck {
  ok: boolean;
  footage: number; // seconds of good footage in the clips
  reel: number; // seconds the Reel should last
  needed: number; // good footage the Reel needs (the Reel plus the margin)
  fits: number; // the longest Reel the footage covers without slow motion or repeats
}

export function checkFootage(clipSeconds: (number | null | undefined)[], reelSeconds: number): FootageCheck {
  const footage = clipSeconds.reduce<number>((sum, s) => sum + (s && s > 0 ? s : 0), 0);
  const needed = reelSeconds * FOOTAGE_HEADROOM;
  const fits = Math.max(MIN_REEL_SECONDS, Math.floor(footage / FOOTAGE_HEADROOM));
  // a little slack for rounding, so a Reel that practically fits is not stopped
  return { ok: footage + 0.3 >= needed, footage, reel: reelSeconds, needed, fits: Math.min(fits, reelSeconds) };
}

/** The length of a local video file, read by the browser (no upload). Null when the browser cannot read it. */
export function readVideoSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (s: number | null) => {
      URL.revokeObjectURL(url);
      resolve(s);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}
