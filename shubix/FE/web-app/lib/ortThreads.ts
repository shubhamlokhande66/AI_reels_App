/** ONNX Runtime's WebAssembly threads for a worker: `elsewhere` (each worker's own choice) on every browser but Safari,
 * which gets one. Every browser on an iPhone / iPad is Safari underneath; threaded WebAssembly there reserves its shared
 * memory up front, and iPhone Safari reloads the page when the memory runs out, which it did right after a model ran.
 * Android browsers (Chrome, Samsung Internet, Firefox ...) are not Safari: their threads are as before. */
export function ortThreads(elsewhere: number): number {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  // iPhone / iPad first: Edge there says "EdgiOS", Chrome "CriOS", yet both are Safari underneath
  const safari = /iP(hone|ad|od)/.test(ua) || (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua));
  return safari ? 1 : elsewhere;
}

/** iPhone / iPad (iPadOS says it is a Mac): Safari there gives a page much less memory. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1);
}
