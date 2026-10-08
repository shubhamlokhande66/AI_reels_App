"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import type { Platform, Post, Rendering } from "@/types/api";
import { btnPrimary, btnSecondary, Card, ErrorBanner } from "./ui";

const NAMES: Record<Platform, string> = { instagram: "Instagram Reels", tiktok: "TikTok", youtube: "YouTube Shorts" };
const STATUS: Record<Post["status"], string> = {
  scheduled: "Scheduled",
  publishing: "Posting…",
  done: "Posted",
  failed: "Failed",
  cancelled: "Cancelled",
};

function defaultCaption(r: Rendering): string {
  const c = r.postCopy;
  if (!c) return "";
  return [c.description || c.title, c.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")].filter(Boolean).join("\n\n");
}

/** Post the finished Reel to the connected platforms now, or schedule it. Platforms that are not connected on the
 * server are shown as such (download + post yourself), so nothing fails silently. */
export function PublishPanel({ projectId, rendering }: { projectId: string; rendering: Rendering }) {
  const qc = useQueryClient();
  const conn = useQuery({ queryKey: ["connections"], queryFn: api.connections, staleTime: 300_000 });
  const posts = useQuery({
    queryKey: ["posts", projectId],
    queryFn: () => api.posts(projectId),
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === "publishing") ? 3000 : false),
  });
  const [chosen, setChosen] = useState<Platform[]>([]);
  const [caption, setCaption] = useState(() => defaultCaption(rendering));
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () => api.publish(projectId, rendering.id, { platforms: chosen, caption, at: when === "later" ? new Date(at).toISOString() : null }),
    onSuccess: () => {
      setChosen([]);
      void qc.invalidateQueries({ queryKey: ["posts", projectId] });
    },
  });
  const cancel = useMutation({
    mutationFn: api.cancelPost,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["posts", projectId] }),
  });

  const platforms = Object.keys(NAMES) as Platform[];
  const anyConnected = platforms.some((p) => conn.data?.[p].connected);

  function submit() {
    setFormError(null);
    if (!chosen.length) return setFormError("Choose at least one platform.");
    if (caption.length > 2200) return setFormError("The caption is too long (2,200 characters at most).");
    if (when === "later") {
      const t = new Date(at).getTime();
      if (!at || Number.isNaN(t)) return setFormError("Choose the date and time to post.");
      if (t < Date.now() + 60_000) return setFormError("Choose a time in the future.");
    }
    publish.mutate();
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-medium">Post it</h3>
        <p className="text-sm text-muted">Publish straight to your accounts, now or at the best time for your audience.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {platforms.map((p) => {
          const ok = conn.data?.[p].connected;
          const on = chosen.includes(p);
          return (
            <button
              key={p}
              type="button"
              disabled={!ok || publish.isPending}
              onClick={() => setChosen(on ? chosen.filter((x) => x !== p) : [...chosen, p])}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                on ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent/60"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              title={ok ? undefined : "Not connected on this server yet: download the Reel and post it yourself"}
            >
              <span className="block font-medium">{NAMES[p]}</span>
              <span className="text-xs text-muted">{conn.isLoading ? "Checking…" : ok ? (on ? "Selected" : "Connected") : "Not connected"}</span>
            </button>
          );
        })}
      </div>

      {conn.data && !anyConnected && (
        <p className="text-xs text-muted">
          No account is connected yet. Use <span className="text-foreground">Download MP4</span> or{" "}
          <span className="text-foreground">Share</span> above and post it from your phone. (The admin connects accounts with
          the platform keys on the server.)
        </p>
      )}

      {anyConnected && (
        <>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Caption</span>
            <textarea
              rows={4}
              value={caption}
              maxLength={2200}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
            />
            <span className="mt-1 block text-right text-xs text-muted">{caption.length}/2200</span>
          </label>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Post now
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule
            </label>
            {when === "later" && (
              <input
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                className="rounded-xl border border-border bg-surface px-3 py-2"
              />
            )}
            <button type="button" className={btnPrimary} disabled={publish.isPending} onClick={submit}>
              {publish.isPending ? "Sending…" : when === "now" ? "Post now" : "Schedule"}
            </button>
          </div>
        </>
      )}

      {(formError || publish.error || cancel.error) && (
        <ErrorBanner message={formError ?? errorMessage(publish.error ?? cancel.error)} />
      )}

      {!!posts.data?.length && (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {posts.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <span className="font-medium">{STATUS[p.status]}</span>{" "}
                <span className="text-muted">
                  · {p.platforms.map((x) => NAMES[x]).join(", ")} ·{" "}
                  {new Date(p.status === "scheduled" ? p.at : p.createdAt).toLocaleString()}
                </span>
                {Object.entries(p.results).map(([k, r]) =>
                  r?.ok ? (
                    r.url ? (
                      <a key={k} href={r.url} target="_blank" rel="noreferrer" className="ml-2 text-accent hover:underline">
                        Open on {NAMES[k as Platform]}
                      </a>
                    ) : null
                  ) : (
                    <p key={k} className="text-xs text-danger">
                      {NAMES[k as Platform]}: {r?.error}
                    </p>
                  ),
                )}
                {p.error && <p className="text-xs text-danger">{p.error}</p>}
              </div>
              {p.status === "scheduled" && (
                <button type="button" className={btnSecondary} disabled={cancel.isPending} onClick={() => cancel.mutate(p.id)}>
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
