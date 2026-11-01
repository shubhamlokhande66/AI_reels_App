"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { usePlanNeed } from "@/hooks/useApi";
import { useTemplates } from "@/lib/useTemplates";

/** A template opened by its link (/create/edit?tpl=…): on a plan lower than the template's (Admin → Templates), straight
 * to the plans instead (like PlanGate for a page). */
export function TemplateGate({ id, children }: { id: string; children: ReactNode }) {
  const { templates, ready } = useTemplates(), need = usePlanNeed(), router = useRouter();
  const t = templates.find((x) => x.id === id);
  const locked = !!need && !!t && need(t.plan);
  useEffect(() => { if (locked) router.replace(`/pricing?need=${encodeURIComponent(`template:${id}`)}`); }, [locked, id, router]);
  if (!need || (!ready && !t) || locked) return <div className="min-h-[40vh]" aria-busy="true" />;
  return <>{children}</>;
}
