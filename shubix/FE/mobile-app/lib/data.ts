import { useCallback } from "react";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useText } from "@shubix/hooks";
import { chooseAction, confirmAction, toast } from "@shubix/ui-mobile";
import { listDef, type ListItem } from "@shubix/core/lib/collections";
import { DEFAULTS, type Features } from "@shubix/core/lib/features-list";
import { DEFAULT_TEMPLATES } from "@shubix/core/lib/studio-templates";
import { DEFAULT_LOCKS, PAGE_LOCK, lockedFor, needMap, type PlanId } from "@shubix/core/lib/plan-locks";
import { mobileApi } from "./api";
import { listProjects, removeProject, type MobileProject } from "./projects";

/** The data the website's pages read (FE/web-app/hooks/useApi.ts), the same requests and the same defaults. */
export const useCredits = () => useQuery({ queryKey: ["native-credits"], queryFn: mobileApi.credits, staleTime: 60_000, retry: false });
export const useFeatures = (): Features => useQuery({ queryKey: ["features"], queryFn: mobileApi.features, staleTime: 60_000, retry: false }).data ?? DEFAULTS;
const useContent = () => useQuery({ queryKey: ["content"], queryFn: mobileApi.content, staleTime: 60_000, retry: false });
/** A list's items: the administrator's (Admin → CMS), else its first items (Shared/core/src/lib/collections.ts). */
export function useList(id: string): ListItem[] {
  return useContent().data?.[id] ?? listDef(id).items;
}
/** The templates people see: the server's list, the defaults until it answers. */
export function useTemplates() {
  return useQuery({ queryKey: ["templates"], queryFn: mobileApi.templates, staleTime: 300_000, retry: false }).data?.templates
    ?? DEFAULT_TEMPLATES.filter((t) => t.on && !t.showFrom && !t.showTo);
}
/** The Reels saved in My Reels (the cloud), when signed in; null while they load. */
export function useSavedReels(on: boolean) {
  const q = useQuery({ queryKey: ["cloud-reels"], queryFn: mobileApi.reels, enabled: on, staleTime: 60_000, retry: false });
  return !on ? null : q.data ? q.data.reels : q.isError ? [] : null;
}
/** The drafts on this phone, newest first, read again each time the page shows; null while they are read. */
export function useDrafts() {
  const q = useQuery({ queryKey: ["drafts"], queryFn: listProjects });
  const { refetch } = q;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  return q.data ? [...q.data].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : null;
}

/** A draft's actions (Home and My Reels): open it, delete it (asked first, then a toast), or its ⋯ menu of both. */
export function useDraftActions() {
  const text = useText(), queryClient = useQueryClient();
  const edit = (draft: MobileProject) => router.push({ pathname: "/editor", params: { id: draft.id } });
  async function remove(draft: MobileProject) {
    if (!await confirmAction({ title: text("reels.deleteDraftTitle", { name: draft.title }), body: text("reels.deleteDraftText"), ok: text("reels.delete"), danger: true })) return;
    try { await removeProject(draft.id); await queryClient.invalidateQueries({ queryKey: ["drafts"] }); toast(text("reels.deleted", { name: draft.title }), "success"); }
    catch { toast(text("reels.deleteFailed"), "danger"); }
  }
  async function menu(draft: MobileProject) {
    const picked = await chooseAction({ title: draft.title, actions: [{ label: text("common.open"), icon: "pen" }, { label: text("reels.delete"), icon: "trash", danger: true }] });
    if (picked === 0) edit(draft); else if (picked === 1) await remove(draft);
  }
  return { edit, remove, menu };
}

/** Plans: what this person may open (the website's useLockCheck / usePlanNeed). null while not known yet. Open to
 * everyone while billing is off. */
function usePlanReach() {
  const credits = useCredits(), d = credits.data;
  if (credits.isLoading) return null;
  return { open: !d || (!d.enabled && !d.billing), plan: d?.enabled ? d.plan : "free" };
}
/** A page's lock (Shared/core plan-locks "page:…"): (address) => the plan it needs, or "" when open. */
export function useLockCheck(): ((href: string) => PlanId | "") | null {
  const locked = useLocked();
  return locked && ((href) => { const key = PAGE_LOCK[href]; return key ? locked(key) : ""; });
}
/** A plan lock by its key (a studio tool: "motion", "bg"…): the plan it needs when out of reach, else "". */
export function useLocked(): ((key: string) => PlanId | "") | null {
  const locks = useQuery({ queryKey: ["plan-locks"], queryFn: mobileApi.planLocks, staleTime: 60_000, retry: false }), reach = usePlanReach();
  if (locks.isLoading || !reach) return null;
  const need = needMap(locks.data ?? DEFAULT_LOCKS);
  return (key) => (need[key] && lockedFor(need[key], reach) ? (need[key] as PlanId) : "");
}
/** Something with its own plan (a template): (plan) => true when it is out of reach. */
export function usePlanNeed(): ((need: PlanId | undefined) => boolean) | null {
  const reach = usePlanReach();
  return reach && ((need) => lockedFor(need, reach));
}
