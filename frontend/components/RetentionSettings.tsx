"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { btnPrimary, btnSecondary, Card, ErrorBanner } from "./ui";

const UNITS = { hours: 1, days: 24 } as const;
type Unit = keyof typeof UNITS;
const MAX_HOURS = 24 * 90;

function split(hours: number): { value: number; unit: Unit } {
  return hours % 24 === 0 ? { value: hours / 24, unit: "days" } : { value: hours, unit: "hours" };
}

export function describeHours(h: number): string {
  if (h % 24 === 0) return `${h / 24} day${h === 24 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"}`;
}

function Amount({ label, hint, value, unit, onChange }: {
  label: string;
  hint: string;
  value: number;
  unit: Unit;
  onChange: (v: { value: number; unit: Unit }) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <span className="mb-2 block text-xs text-muted">{hint}</span>
      <span className="flex gap-2">
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange({ value: e.target.valueAsNumber, unit })}
          className="w-28 rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
        />
        <select
          value={unit}
          onChange={(e) => onChange({ value, unit: e.target.value as Unit })}
          className="rounded-xl border border-border bg-surface px-3 py-2"
        >
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </span>
    </label>
  );
}

/** Admin: how long uploaded clips and whole projects are kept before they are deleted automatically. */
export function RetentionSettings() {
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ["retention"], queryFn: api.retention });
  const [enabled, setEnabled] = useState(false);
  const [uploads, setUploads] = useState<{ value: number; unit: Unit }>({ value: 2, unit: "hours" });
  const [projects, setProjects] = useState<{ value: number; unit: Unit }>({ value: 1, unit: "days" });
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const data = current.data;
  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form starts from the saved setting once it loads
    setEnabled(data.enabled);
    setUploads(split(data.uploadsHours));
    setProjects(split(data.projectsHours));
  }, [data]);

  const save = useMutation({
    mutationFn: (body: { enabled: boolean; uploadsHours: number; projectsHours: number }) => api.setRetention(body),
    onSuccess: (r) => {
      qc.setQueryData(["retention"], r);
      setSaved(true);
    },
  });
  const run = useMutation({ mutationFn: api.runRetention });

  function submit() {
    setFormError(null);
    setSaved(false);
    const u = uploads.value * UNITS[uploads.unit];
    const p = projects.value * UNITS[projects.unit];
    if (!Number.isInteger(uploads.value) || !Number.isInteger(projects.value) || u < 1 || p < 1)
      return setFormError("Enter whole numbers of at least 1.");
    if (u > MAX_HOURS || p > MAX_HOURS) return setFormError("At most 90 days.");
    if (p < u) return setFormError("Keep projects at least as long as their uploaded clips.");
    save.mutate({ enabled, uploadsHours: u, projectsHours: p });
  }

  return (
    <Card className="max-w-lg space-y-5">
      <div>
        <h2 className="font-medium">Automatic deletion</h2>
        <p className="mt-1 text-sm text-muted">
          Keep users&apos; footage only as long as needed. Times count from the last change to a project. A project that is
          rendering, or has a post still scheduled, is never deleted.
        </p>
      </div>
      {current.isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            <span className="font-medium">Delete automatically</span>
          </label>
          <div className={`space-y-4 ${enabled ? "" : "opacity-50"}`}>
            <Amount
              label="Delete uploaded clips and songs after"
              hint="The finished Reel stays downloadable; making a new version then needs a new upload."
              {...uploads}
              onChange={setUploads}
            />
            <Amount
              label="Delete the whole project after"
              hint="The Reels, versions and project details go too."
              {...projects}
              onChange={setProjects}
            />
          </div>
          {(formError || save.error || run.error) && <ErrorBanner message={formError ?? errorMessage(save.error ?? run.error)} />}
          {saved && !save.isPending && <p className="text-sm text-success">✓ Saved. It applies within 10 minutes.</p>}
          {run.data && (
            <p className="text-sm text-muted">
              Done: cleared the uploads of {run.data.uploads} project(s), deleted {run.data.projects} project(s).
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={save.isPending} onClick={submit}>
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={btnSecondary}
              disabled={run.isPending || !data?.enabled}
              onClick={() => run.mutate()}
              title={data?.enabled ? undefined : "Switch it on and save first"}
            >
              {run.isPending ? "Running…" : "Run now"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

/** Users: when this project's files go (auto-delete on), counted from its last change, so they download in time. */
export function RetentionNotice({ updatedAt, hasReel }: { updatedAt: string; hasReel: boolean }) {
  const r = useQuery({ queryKey: ["retention"], queryFn: api.retention, staleTime: 300_000 });
  if (!r.data?.enabled) return null;
  const at = (h: number) => new Date(new Date(updatedAt).getTime() + h * 3_600_000);
  const fmt = (d: Date) => d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <p className="rounded-2xl border border-border bg-surface-2/50 px-4 py-3 text-xs text-muted">
      <span className="text-accent">⏱</span> For your privacy, uploaded clips are deleted {describeHours(r.data.uploadsHours)} after your
      last change (around {fmt(at(r.data.uploadsHours))}) and this project after {describeHours(r.data.projectsHours)} (around{" "}
      {fmt(at(r.data.projectsHours))}).{hasReel ? " Download or post your Reel before then." : ""}
    </p>
  );
}
