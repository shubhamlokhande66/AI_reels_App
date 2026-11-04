/** The AI models run by the phone itself (modules/shubix-video/.../Models.kt, reached through the app's file server). When
 * that fails for any reason the WebAssembly copy takes over and the failure is written to the console. */

export type Native = { base: string; key: string };
export type Feed = { type: string; data: Float32Array | BigInt64Array; dims: readonly number[] };
type Out = Record<string, { type: string; data: Float32Array; dims: number[] }>;
type Runs = { run: (feeds: Record<string, Feed>) => Promise<unknown> };

/** The file server on this phone; nothing on a page outside the app. */
export function phoneModels(): Native | undefined {
  const p = (globalThis as unknown as { __phone?: Partial<Native> }).__phone;
  return p?.base && p.key ? { base: p.base, key: p.key } : undefined;
}

// the file server's name of a model: its path for the API's own files, the address for the voices
const nameOf = (n: Native, url: string) => { const u = new URL(url, n.base); return url.startsWith("https:") ? u.href : u.pathname; };
const route = (n: Native, path: string, url: string) => `${n.base}/${path}?k=${n.key}&u=${encodeURIComponent(nameOf(n, url))}`;

/** The model's file on the phone, downloaded the first time (lines of progress, then "ok"). */
export async function holdModel(n: Native, url: string, onProgress?: (p: number) => void): Promise<void> {
  const res = await fetch(route(n, "model", url), { method: "POST" });
  if (!res.ok || !res.body) throw new Error(`model file: ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += value;
    const lines = text.split("\n"); text = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "ok") return;
      const p = Number(line);
      if (!Number.isFinite(p) || !line) throw new Error(line);
      onProgress?.(p);
    }
  }
  throw new Error("model file: the answer stopped");
}

export async function runModel(n: Native, url: string, feeds: Record<string, Feed>): Promise<Out> {
  const names = Object.keys(feeds);
  const head = new TextEncoder().encode(JSON.stringify(names.map((k) => ({ n: k, t: feeds[k].type, d: feeds[k].dims, l: feeds[k].data.byteLength }))));
  const res = await fetch(route(n, "onnx", url), { method: "POST", body: new Blob([new Uint32Array([head.length]), head, ...names.map((k) => feeds[k].data as BlobPart)]) });
  if (!res.ok) throw new Error(`model run: ${res.status} ${await res.text()}`);
  const body = await res.arrayBuffer(), length = new DataView(body).getUint32(0, true), out: Out = {};
  let at = 4 + length;
  for (const t of JSON.parse(new TextDecoder().decode(new Uint8Array(body, 4, length))) as { n: string; t: string; d: number[]; l: number }[]) {
    out[t.n] = { type: t.t, dims: t.d, data: new Float32Array(body.slice(at, at + t.l)) };
    at += t.l;
  }
  return out;
}

/** The chance of speech in every 512 samples of a 16 kHz sound. */
export async function speechOnPhone(n: Native, url: string, samples: Float32Array): Promise<Float32Array> {
  await holdModel(n, url);
  const res = await fetch(route(n, "speech", url), { method: "POST", body: new Blob([samples as BlobPart]) });
  if (!res.ok) throw new Error(`speech: ${res.status} ${await res.text()}`);
  return new Float32Array(await res.arrayBuffer());
}

/** A session for a worker: the phone's model, or `wasm` from the first moment the phone's fails. Same run() and outputs. */
export async function phoneFirst<S extends Runs>(n: Native | undefined, url: string, wasm: () => Promise<S>, onProgress?: (p: number) => void): Promise<S> {
  if (!n) return wasm();
  let local: Promise<S> | null = null;
  const fall = (e: unknown) => { console.warn("[models] the phone's model failed, WebAssembly instead:", url, e); return local ??= wasm(); };
  try { await holdModel(n, url, onProgress); } catch (e) { return fall(e); }
  return { run: async (feeds: Record<string, Feed>) => {
    if (local) return (await local).run(feeds);
    try { return await runModel(n, url, feeds); } catch (e) { return (await fall(e)).run(feeds); }
  } } as S;
}
