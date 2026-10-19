import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FastStudio } from "@/components/studio/FastStudio";

/** Fast Studio, one address per way in:
 * - /create/music, /create/talking, /create/photo: the Create flow of that kind, its defaults set (components/studio/flow.ts)
 * - /create/story: Story Maker on the phone (components/studio/auto.ts)
 * - /create/edit: a saved Reel opened again (?p=<draft>) or a template (?tpl=<id>); with neither there is nothing to
 *   open, so it is a 404 */
const KINDS = { music: "Music Reel", talking: "Talking Reel", photo: "Photo Reel", story: "Story Maker", edit: "Your Reel" } as const;
type Kind = keyof typeof KINDS;
const FLOW = new Set<Kind>(["music", "talking", "photo"]); // drawn in the Create flow from the first paint

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
  if (kind === "edit") {
    const q = await searchParams;
    if (!q.p && !q.tpl) notFound();
  }
  return <FastStudio kind={FLOW.has(kind as Kind) ? (kind as "music" | "talking" | "photo") : undefined} />;
}
