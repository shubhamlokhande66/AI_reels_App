"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Chip, ChipRow, Icon, Spinner } from "@/components/atoms";
import { EmptyState, PageHeader, SearchBox } from "@/components/molecules";
import { SectionHeader } from "@/components/molecules/SectionHeader";
import { PlanGate } from "@/components/organisms/PlanGate";
import { TemplateCard } from "@/components/molecules/TemplateCard";
import { groupsOf, lookName, type StudioTemplate } from "@/lib/studio-templates";
import { useTemplates } from "@/lib/useTemplates";
import { useT } from "@/hooks/useApi";

const GRID = "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6";

/** Templates: the ready-made Reels, by group, searchable and filtered by group (or the new ones); each opens the Create
 * page with it picked. Every text: Admin → CMS → Templates. */
export default function TemplatesPage() {
  const t = useT();
  return (
    <PlanGate item="page:templates">
      <Suspense fallback={<Spinner label={t("templates.loading")} />}>
        <Templates />
      </Suspense>
    </PlanGate>
  );
}

function Templates() {
  const t = useT();
  // the header's search (/templates?q=…): the name, the kind, the look and what the template does
  const { templates } = useTemplates();
  const [q, setQ] = useState(useSearchParams().get("q") ?? "");
  const [group, setGroup] = useState<string>("all");
  const s = q.trim().toLowerCase();
  const found = (x: StudioTemplate) => !s || [x.name, x.text, lookName(x), x.group, x.kind].join(" ").toLowerCase().includes(s);
  const inGroup = (x: StudioTemplate) => group === "all" || (group === "new" ? !!x.isNew : x.group === group);
  const shown = templates.filter((x) => found(x) && inGroup(x));
  const groups = groupsOf(templates);
  const hasNew = templates.some((x) => x.isNew);
  const chips = [
    { id: "all", label: t("templates.all"), n: templates.length },
    ...(hasNew ? [{ id: "new", label: t("templates.newChip"), n: templates.filter((x) => x.isNew).length }] : []),
    ...groups.map((g) => ({ id: g, label: g, n: templates.filter((x) => x.group === g).length })),
  ];
  const byGroup = group === "all" && !s; // the whole library: a section per group

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader title={t("nav.templates")} subtitle={t("templates.sub")} />

      <div className="flex flex-col gap-3">
        <SearchBox value={q} onChange={setQ} label={t("templates.search")} className="md:max-w-md" />
        <ChipRow role="radiogroup" aria-label={t("nav.templates")}>
          {chips.map((c) => (
            <Chip key={c.id} role="radio" aria-checked={group === c.id} on={group === c.id} onClick={() => setGroup(c.id)}>
              {c.id === "new" && <Icon name="sparkle" size={13} className="text-accent" />}{c.label}<span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{c.n}</span>
            </Chip>
          ))}
        </ChipRow>
      </div>

      {!shown.length ? (
        <EmptyState icon="search" title={t("templates.none", { q: q.trim() || chips.find((c) => c.id === group)?.label || "" })} hint={t("templates.noneHint")}
          action={<Button variant="secondary" onClick={() => { setQ(""); setGroup("all"); }}>{t("templates.clear")}</Button>} />
      ) : byGroup ? (
        groups.map((g) => {
          const list = templates.filter((x) => x.group === g);
          return (
            <section key={g} aria-label={g} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <SectionHeader title={g} />
                <button type="button" onClick={() => setGroup(g)} className="shrink-0 text-[12.5px] font-semibold text-muted hover:text-accent">{t("templates.count", { n: list.length })}</button>
              </div>
              <div className={GRID}>{list.map((x) => <TemplateCard key={x.id} t={x} />)}</div>
            </section>
          );
        })
      ) : (
        <section aria-label={t("nav.templates")} className="flex flex-col gap-3">
          <p className="m-0 text-[12.5px] text-muted">{t("templates.count", { n: shown.length })}</p>
          <div className={GRID}>{shown.map((x) => <TemplateCard key={x.id} t={x} />)}</div>
        </section>
      )}
    </div>
  );
}
