"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dropzone } from "./Dropzone";
import { ProgressBar } from "./ProgressStages";
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorBanner } from "./ui";
import { api, errorMessage } from "@/lib/api";
import { PICKER_VIDEO, isVideoFile } from "@/lib/format";

const BATCH = 3; // Reels sent per request: each is measured on the server (~10-20 s)
const MAX_MB = 300;

type Item = { file: File; status: "waiting" | "learning" | "done" | "failed"; error?: string };

/** Teach the app with many trending Reels at once (50, 100 ...), then sort them into editing styles automatically. */
export function TrendLibrary() {
  const qc = useQueryClient();
  const lib = useQuery({ queryKey: ["trend-library"], queryFn: api.trendLibrary });
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grouped, setGrouped] = useState<string | null>(null);
  const stop = useRef(false);

  const group = useMutation({
    mutationFn: api.groupTrends,
    onSuccess: (styles) => {
      const n = styles.reduce((a, s) => a + (s.profile.videos ?? s.videos.length), 0);
      setGrouped(
        styles.length === 1
          ? `Learned the style "${styles[0].name}" from ${n} Reel${n === 1 ? "" : "s"}.${n < 5 ? " Add a few more Reels of this kind to make it steadier." : ""}`
          : `Sorted ${n} Reels into ${styles.length} styles: ${styles.map((s) => s.name).join(", ")}.`,
      );
      void qc.invalidateQueries({ queryKey: ["references"] });
      void qc.invalidateQueries({ queryKey: ["trend-library"] });
    },
  });
  const clear = useMutation({
    mutationFn: api.clearTrendLibrary,
    onSuccess: () => {
      setGrouped(null);
      void qc.invalidateQueries({ queryKey: ["references"] });
      void qc.invalidateQueries({ queryKey: ["trend-library"] });
    },
  });

  function add(files: File[]) {
    setError(null);
    const ok = files.filter((f) => isVideoFile(f) && f.size <= MAX_MB * 1024 * 1024);
    if (ok.length < files.length) setError(`${files.length - ok.length} file(s) skipped: not a video, or larger than ${MAX_MB} MB.`);
    setItems((xs) => [...xs, ...ok.map((file) => ({ file, status: "waiting" as const }))]);
  }

  async function run() {
    setError(null);
    setGrouped(null);
    setRunning(true);
    stop.current = false;
    const todo = items.map((it, i) => ({ it, i })).filter(({ it }) => it.status === "waiting" || it.status === "failed");
    for (let k = 0; k < todo.length && !stop.current; k += BATCH) {
      const batch = todo.slice(k, k + BATCH);
      setItems((xs) => xs.map((x, i) => (batch.some((b) => b.i === i) ? { ...x, status: "learning", error: undefined } : x)));
      try {
        const r = await api.learnTrends(batch.map((b) => b.it.file));
        const failed = new Map(r.failed.map((f) => [f.name, f.error]));
        setItems((xs) =>
          xs.map((x, i) => {
            if (!batch.some((b) => b.i === i)) return x;
            const err = failed.get(x.file.name);
            return err ? { ...x, status: "failed", error: err } : { ...x, status: "done" };
          }),
        );
      } catch (e) {
        const msg = errorMessage(e);
        setItems((xs) => xs.map((x, i) => (batch.some((b) => b.i === i) ? { ...x, status: "failed", error: msg } : x)));
      }
    }
    setRunning(false);
    await qc.invalidateQueries({ queryKey: ["trend-library"] });
    if (!stop.current) group.mutate(); // sort everything into styles straight away
  }

  const done = items.filter((x) => x.status === "done").length;
  const failed = items.filter((x) => x.status === "failed").length;
  const waiting = items.filter((x) => x.status === "waiting").length;
  const count = lib.data?.count ?? 0;

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-medium">Teach the app with many Reels</h2>
        <p className="text-sm text-muted">
          Add 20, 50 or 100+ trending Reels at once. Each is measured (cut timing, beat sync, shot lengths in loud and calm parts, hook,
          colour) and then deleted; only the numbers are kept. The app sorts them into editing styles by itself, and newer Reels count more,
          so it keeps up with trends. When you create a Reel, the style that fits is used automatically.
        </p>
        {count > 0 && (
          <p className="mt-2 text-sm">
            <span className="font-semibold text-accent">{count}</span> Reels learned so far
            {lib.data?.styles ? ` · ${lib.data.styles} automatic style${lib.data.styles === 1 ? "" : "s"}` : ""}.
          </p>
        )}
      </div>

      <Dropzone
        accept={PICKER_VIDEO}
        multiple
        disabled={running}
        validate={isVideoFile}
        onFiles={add}
        label="Drop trending Reels here, or choose many at once"
        hint={`MP4 / MOV, up to ${MAX_MB} MB each`}
      />

      {items.length > 0 && (
        <div className="space-y-3">
          <ProgressBar value={items.length ? Math.round((100 * (done + failed)) / items.length) : 0} label="Learning" showEta={running} />
          <p className="text-sm text-muted">
            {done} learned · {failed} could not be read · {waiting} waiting · {items.length} added
          </p>
          <details>
            <summary className="cursor-pointer text-sm text-muted hover:text-accent">Show each Reel</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
              {items.map((x, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{x.file.name}</span>
                  <span
                    className={`shrink-0 ${x.status === "done" ? "text-success" : x.status === "failed" ? "text-danger" : x.status === "learning" ? "text-accent" : "text-muted"}`}
                    title={x.error}
                  >
                    {x.status === "done" ? "✓ learned" : x.status === "failed" ? "✕ could not be read" : x.status === "learning" ? "measuring…" : "waiting"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {(error || group.error || clear.error) && <ErrorBanner title="Could not finish" message={error ?? errorMessage(group.error ?? clear.error)} />}
      {grouped && <p className="rounded-2xl border border-success/40 bg-success/10 p-3 text-sm text-success">✓ {grouped}</p>}

      <div className="flex flex-wrap gap-2">
        {running ? (
          <button type="button" className={btnSecondary} onClick={() => (stop.current = true)}>
            Stop after this batch
          </button>
        ) : (
          <button type="button" className={btnPrimary} disabled={waiting + failed === 0} onClick={() => void run()}>
            {failed && !waiting ? `Try the ${failed} failed again` : waiting ? `Learn ${waiting} Reel${waiting === 1 ? "" : "s"}` : "Learn"}
          </button>
        )}
        <button type="button" className={btnSecondary} disabled={running || group.isPending || count < 1} onClick={() => group.mutate()}>
          {group.isPending ? "Sorting into styles…" : "Sort into styles again"}
        </button>
        {count > 0 && (
          <button
            type="button"
            className={btnDanger}
            disabled={running || clear.isPending}
            onClick={() => {
              if (window.confirm(`Forget all ${count} learned Reels and the automatic styles? Your own trends stay.`)) clear.mutate();
            }}
          >
            Forget learned Reels
          </button>
        )}
      </div>
    </Card>
  );
}
