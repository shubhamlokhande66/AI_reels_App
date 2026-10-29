"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Chip, ChipRow, Icon, Spinner } from "@/components/atoms";
import { EmptyState, PageHeader, SearchBox } from "@/components/molecules";
import { SectionHeader } from "@/components/molecules/SectionHeader";
import { PlanGate } from "@/components/organisms/PlanGate";
import { TemplateCard } from "@/components/molecules/TemplateCard";
import { groupsOf, lookName, type StudioTemplate } from "@shubix/core/lib/studio-templates";
import { useTemplates } from "@/lib/useTemplates";
import { useText } from "@/hooks/useApi";

const GRID = "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6";

/** Templates: the ready-made Reels, by group, searchable and filtered by group (or the new ones); each opens the Create
 * page with it picked. Every text: Admin → CMS → Templates. */
export default function TemplatesPage() {
  const text = useText();
  return (
    <PlanGate item="page:templates">
      <Suspense fallback={<Spinner label={text("templates.loading")} />}>
        <Templates />
      </Suspense>
    </PlanGate>
  );
}

function Templates() {
  const text = useText();
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
    { id: "all", label: text("templates.all"), n: templates.length },
    ...(hasNew ? [{ id: "new", label: text("templates.newChip"), n: templates.filter((x) => x.isNew).length }] : []),
    ...groups.map((g) => ({ id: g, label: g, n: templates.filter((x) => x.group === g).length })),
  ];
  const byGroup = group === "all" && !s; // the whole library: a section per group

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-4 md:gap-8">
      <header className="relative isolate overflow-hidden rounded-[24px] border border-[color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[linear-gradient(125deg,color-mix(in_srgb,var(--accent)_10%,var(--surface)),var(--surface)_55%,color-mix(in_srgb,var(--accent)_4%,var(--surface)))] px-4 py-5 shadow-[0_20px_50px_-38px_rgba(0,0,0,.8)] sm:px-6 sm:py-6 md:rounded-[28px] md:px-8 md:py-8">
        <span aria-hidden className="pointer-events-none absolute -right-8 -top-16 -z-10 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 left-[30%] -z-10 h-40 w-72 rounded-full bg-accent/5 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[.2em] text-accent"><span className="h-px w-5 bg-accent/70" />{text("templates.eyebrow")}</span>
            <PageHeader title={text("nav.templates")} subtitle={text("templates.sub")} />
          </div>
          <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[color-mix(in_srgb,var(--surface)_66%,transparent)] px-3 py-2 text-[10px] font-semibold text-muted backdrop-blur-xl">
            <Icon name="reels" size={14} className="text-accent" />{text("templates.count", { n: templates.length })}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-3 rounded-[20px] border border-[color-mix(in_srgb,var(--accent)_12%,var(--line))] bg-[color-mix(in_srgb,var(--surface)_54%,transparent)] p-3 shadow-[0_14px_36px_-34px_rgba(0,0,0,.8)] sm:p-4">
        <SearchBox value={q} onChange={setQ} label={text("templates.search")} className="md:max-w-md" />
        <ChipRow role="radiogroup" aria-label={text("nav.templates")} className="gap-2">
          {chips.map((c) => (
            <Chip key={c.id} role="radio" aria-checked={group === c.id} on={group === c.id} onClick={() => setGroup(c.id)} className="!h-9 !px-3.5 !text-[11.5px]">
              {c.id === "new" && <Icon name="sparkle" size={13} className="text-accent" />}{c.label}<span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-muted">{c.n}</span>
            </Chip>
          ))}
        </ChipRow>
      </div>

      {!shown.length ? (
        <EmptyState icon="search" title={text("templates.none", { q: q.trim() || chips.find((c) => c.id === group)?.label || "" })} hint={text("templates.noneHint")}
          action={<Button variant="secondary" onClick={() => { setQ(""); setGroup("all"); }}>{text("templates.clear")}</Button>} />
      ) : byGroup ? (
        groups.map((g) => {
          const list = templates.filter((x) => x.group === g);
          return (
            <section key={g} aria-label={g} className="flex flex-col gap-3.5 border-t border-[color-mix(in_srgb,var(--accent)_12%,var(--line))] pt-5 first:border-t-0 first:pt-0 md:gap-4 md:pt-6">
              <div className="flex items-center justify-between gap-3">
                <SectionHeader title={g} />
                <button type="button" onClick={() => setGroup(g)} className="shrink-0 rounded-full border border-border/70 bg-surface/60 px-3 py-1.5 text-[10.5px] font-semibold text-muted transition-[border-color,color,background] duration-200 hover:border-accent/40 hover:bg-accent/5 hover:text-accent">{text("templates.count", { n: list.length })}</button>
              </div>
              <div className={GRID}>{list.map((x) => <TemplateCard key={x.id} t={x} />)}</div>
            </section>
          );
        })
      ) : (
        <section aria-label={text("nav.templates")} className="flex flex-col gap-3.5">
          <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[.13em] text-muted">{text("templates.count", { n: shown.length })}</p>
          <div className={GRID}>{shown.map((x) => <TemplateCard key={x.id} t={x} />)}</div>
        </section>
      )}
    </div>
  );
}
