import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FastStudio } from "@/components/studio/FastStudio";
import { PlanGate } from "@/components/organisms/PlanGate";

/** Fast Studio, one address per way in:
 * - /create/music, /create/talking, /create/photo, /create/copy: the Create flow of that kind, its defaults set
 *   (components/studio/flow.ts); Copy a Reel starts by picking the Reel to copy
 * - /create/story: Story Maker on the phone (components/studio/auto.ts)
 * - /create/edit: a saved Reel opened again (?p=<draft>) or a template (?tpl=<id>); with neither there is nothing to
 *   open, so it is a 404 */
const KINDS = { music: "Music Reel", talking: "Talking Reel", photo: "Photo Reel", copy: "Copy a Reel", story: "Story Maker", edit: "Your Reel" } as const;
type Kind = keyof typeof KINDS;
const FLOW = new Set<Kind>(["music", "talking", "photo", "copy"]); // drawn in the Create flow from the first paint

export const dynamicParams = false; // any other /create/... is a 404
export function generateStaticParams() {
  return Object.keys(KINDS).map((kind) => ({ kind }));
}

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params;
  return { title: KINDS[kind as Kind] ?? "Create" };
}

export default async function CreatePage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { kind } = await params;
  if (!(kind in KINDS)) notFound();
  const q = await searchParams;
  if (kind === "edit" && !q.p && !q.tpl) notFound();
  const studio = <FastStudio kind={FLOW.has(kind as Kind) ? (kind as "music" | "talking" | "photo" | "copy") : undefined} />;
  // Copy a Reel, Story Maker and a template open on their plan (lib/plan-locks.ts "page:…"); a saved Reel always opens
  const lock = kind === "copy" ? "page:copy" : kind === "story" ? "page:story" : kind === "edit" && q.tpl && !q.p ? "page:templates" : "";
  return lock ? <PlanGate item={lock}>{studio}</PlanGate> : studio;
}
