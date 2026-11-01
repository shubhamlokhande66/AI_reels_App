import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FastStudio } from "@/components/studio/FastStudio";
import { PlanGate } from "@/components/organisms/PlanGate";
import { TemplateGate } from "@/components/organisms/TemplateGate";

/** Fast Studio, one address per way in:
 * - /create/music, /create/talking, /create/photo, /create/copy: the Create flow of that kind, its defaults set
 *   (components/studio/flow.ts); Copy a Reel starts by picking the Reel to copy
 * - /create/story: Story Maker on the phone (components/studio/auto.ts)
 * - /create/edit: legacy saved Reel / template links redirect to /editor with their original query parameters */
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
  if (kind === "edit") {
    const target = new URLSearchParams();
    for (const [key, value] of Object.entries(q)) {
      if (typeof value === "string") target.set(key, value);
      else if (Array.isArray(value)) value.forEach((item) => target.append(key, item));
    }
    redirect(`/editor?${target.toString()}`);
  }
  const studio = <FastStudio kind={FLOW.has(kind as Kind) ? (kind as "music" | "talking" | "photo" | "copy") : undefined} />;
  // Copy a Reel, Story Maker and a template open on their plan (lib/plan-locks.ts "page:…"); a saved Reel always opens
  const lock = kind === "copy" ? "page:copy" : kind === "story" ? "page:story" : kind === "edit" && q.tpl && !q.p ? "page:templates" : "";
  // a template has its own plan too (Admin → Templates)
  const tpl = kind === "edit" && typeof q.tpl === "string" && !q.p ? q.tpl : "";
  const gated = tpl ? <TemplateGate id={tpl}>{studio}</TemplateGate> : studio;
  return lock ? <PlanGate item={lock}>{gated}</PlanGate> : gated;
}
