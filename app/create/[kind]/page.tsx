import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FastStudio } from "@/components/studio/FastStudio";

/** The Create flow of one kind of Reel, each at its own address: /create/music, /create/talking, /create/photo.
 * The same page (Fast Studio) with that kind picked and its defaults set (components/studio/flow.ts). */
const KINDS = { music: "Music Reel", talking: "Talking Reel", photo: "Photo Reel" } as const;
type Kind = keyof typeof KINDS;

export const dynamicParams = false; // any other /create/... is a 404
export function generateStaticParams() {
  return Object.keys(KINDS).map((kind) => ({ kind }));
}

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params;
  return { title: KINDS[kind as Kind] ?? "Create" };
}

export default async function CreatePage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(kind in KINDS)) notFound();
  return <FastStudio kind={kind as Kind} />;
}
