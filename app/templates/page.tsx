"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon, Spinner } from "@/components/atoms";
import { PageHeader } from "@/components/molecules";
import { PlanGate } from "@/components/organisms/PlanGate";
import { TemplateCard } from "@/components/molecules/TemplateCard";
import { groupsOf, lookName, type StudioTemplate } from "@/lib/studio-templates";
import { useTemplates } from "@/lib/useTemplates";

/** Templates: the ready-made Reels, by group, searchable; each opens the Create page with it picked. */
export default function TemplatesPage() {
  return (
    <PlanGate item="page:templates">
      <Suspense fallback={<Spinner label="Loading templates…" />}>
        <Templates />
      </Suspense>
    </PlanGate>
  );
}

function Templates() {
  // the header's search (/templates?q=…): the name, the kind, the look and what the template does
  const { templates } = useTemplates();
  const [q, setQ] = useState(useSearchParams().get("q") ?? "");
  const s = q.trim().toLowerCase();
  const found = (t: StudioTemplate) => !s || [t.name, t.text, lookName(t), t.group, t.kind].join(" ").toLowerCase().includes(s);
  const any = templates.some(found);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <PageHeader title="Templates" subtitle="Pick a ready-made Reel, add your clips: the style, look, length and text are done for you." />
      <label className="srch md:max-w-sm">
        <Icon name="search" size={16} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" />
      </label>
      {!any && <p className="mu sm">No template matches “{q}”.</p>}
      {groupsOf(templates).map((g) => {
        const list = templates.filter((t) => t.group === g && found(t));
        if (!list.length) return null;
        return (
          <section key={g} aria-label={g} className="flex flex-col gap-2.5">
            <h2 className="ht">{g}</h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {list.map((t) => (
                <TemplateCard key={t.id} t={t} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
