"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GenerateOptions, Job, Project, ProjectStatus, TimelineState } from "@/types/api";

export const keys = {
  projects: (status?: ProjectStatus) => ["projects", status ?? "all"] as const,
  project: (id: string) => ["project", id] as const,
  job: (pid: string, jid: string) => ["job", pid, jid] as const,
  renderings: (id: string) => ["renderings", id] as const,
  styles: ["styles"] as const,
  health: ["health"] as const,
  timeline: (id: string) => ["timeline", id] as const,
  preview: (id: string) => ["preview", id] as const,
  queue: ["queue"] as const,
};

const ACTIVE = new Set(["queued", "processing"]);

export function useProjects(status?: ProjectStatus) {
  return useQuery({
    queryKey: keys.projects(status),
    queryFn: () => api.listProjects(status),
    // keep the dashboard live while something is rendering, even in a background tab (the render itself never pauses)
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === "processing") ? 2000 : false),
    refetchIntervalInBackground: true,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: keys.project(id),
    queryFn: () => api.getProject(id),
    // Poll the project while its job runs so the page flips to the result on its own — kept alive in a background tab too.
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 1000 : false),
    refetchIntervalInBackground: true,
  });
}

export function useJob(projectId: string, jobId: string | undefined, enabled = true) {
  return useQuery<Job>({
    queryKey: keys.job(projectId, jobId ?? ""),
    queryFn: () => api.getJob(projectId, jobId as string),
    enabled: enabled && !!jobId,
    // The job runs on the server regardless of this tab; keep watching it even while the tab is hidden.
    refetchInterval: (q) => (q.state.data && !ACTIVE.has(q.state.data.status) ? false : 800),
    refetchIntervalInBackground: true,
  });
}

export function useRenderings(id: string, enabled = true) {
  return useQuery({ queryKey: keys.renderings(id), queryFn: () => api.renderings(id), enabled });
}

export function useStyles() {
  return useQuery({ queryKey: keys.styles, queryFn: api.styles, staleTime: 5 * 60_000 });
}

export function useTrends() {
  return useQuery({ queryKey: ["trends"], queryFn: api.trends, staleTime: 5 * 60_000 });
}

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: api.health, refetchInterval: 15_000, retry: false });
}

export function useGenerate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: GenerateOptions) => api.generate(projectId, opts),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.project(projectId) });
      await qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useCancelJob(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.cancelJob(projectId, jobId),
    onSuccess: async () => {
      // the job does not stop instantly — this refresh shows "cancelling…" state; polling picks up the rest
      await qc.invalidateQueries({ queryKey: keys.project(projectId) });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export type { Project };


// ---- editor -----------------------------------------------------------------
export function useTimeline(id: string) {
  return useQuery({ queryKey: keys.timeline(id), queryFn: () => api.timeline(id) });
}

/** Every edit goes to the server (it validates and keeps undo/redo); the response is the new truth. */
export function useTimelineActions(id: string) {
  const qc = useQueryClient();
  const set = (state: TimelineState) => {
    qc.setQueryData(keys.timeline(id), state);
    qc.invalidateQueries({ queryKey: keys.project(id) });
  };
  const edit = useMutation({ mutationFn: (v: { ops: object[]; label?: string }) => api.editTimeline(id, v.ops, v.label), onSuccess: set });
  const undo = useMutation({ mutationFn: () => api.undo(id), onSuccess: set });
  const redo = useMutation({ mutationFn: () => api.redo(id), onSuccess: set });
  const restore = useMutation({ mutationFn: (rid: string) => api.restore(id, rid), onSuccess: set });
  return { edit, undo, redo, restore, set };
}

export function useRenderTimeline(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { quality: "preview" | "final"; label?: string }) => api.render(id, v.quality, v.label),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.project(id) }),
  });
}

export function useQueue() {
  return useQuery({
    queryKey: keys.queue,
    queryFn: api.queue,
    refetchInterval: (q) => (q.state.data?.some((j) => j.position !== null) ? 1500 : 8000),
    refetchIntervalInBackground: true,
  });
}
