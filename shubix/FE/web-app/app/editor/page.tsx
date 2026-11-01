import type { Metadata } from "next";
import { PlanGate } from "@/components/organisms/PlanGate";
import { TemplateGate } from "@/components/organisms/TemplateGate";
import { FastStudio } from "@/components/studio/FastStudio";
import { EditorPreview } from "./EditorPreview";

export const metadata: Metadata = { title: "Reel Editor" };

/** A generated Reel opens here with the same working studio editor and its saved project ID.
 * Without a project ID, keep the standalone interactive editor preview available. */
export default async function EditorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const id = typeof q.p === "string" ? q.p : "";
  const templateId = !id && typeof q.tpl === "string" ? q.tpl : "";
  const liveSession = q.session === "1";
  if (id || liveSession) return <FastStudio />;
  if (templateId) return <PlanGate item="page:templates"><TemplateGate id={templateId}><FastStudio /></TemplateGate></PlanGate>;
  return <EditorPreview />;
}
