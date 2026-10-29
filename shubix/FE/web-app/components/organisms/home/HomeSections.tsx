"use client";

import { Skeleton } from "@/components/atoms/Spinner";
import { CreateCard } from "@/components/molecules/CreateCard";
import { DraftCard } from "@/components/molecules/DraftCard";
import { EmptyState } from "@/components/molecules/EmptyState";
import { Scroller, SectionHeader } from "@/components/molecules/SectionHeader";
import { TemplateCard } from "@/components/molecules/TemplateCard";
import { TipCard } from "@/components/molecules/TipCard";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { Button } from "@/components/atoms/Button";
import { clock, deleteDraft, draftPreview, type Draft } from "@/lib/drafts";
import { linkOn, type Features } from "@shubix/core/lib/features-list";
import { lockTag, PAGE_LOCK, type PlanId } from "@shubix/core/lib/plan-locks";
import { useList, useLockCheck, useText } from "@/hooks/useApi";
import type { ListItem } from "@shubix/core/lib/collections";
import { formatRelative } from "@/lib/format";
import { useTemplates } from "@/lib/useTemplates";
import type { Tone } from "@/lib/ui";

/** Home's sections (UI/ design), each one reusable on its own: Create Your Reel, Popular Templates, Continue Editing,
 * Tips for Better Reels. */

type Option = { key: string; href: string; icon: string; title: string; text: string; tone: Tone; reload?: boolean };

/** The ways to start (and My Reels): the administrator's cards (Admin → CMS → Home → Create Your Reel), as far as this
 * studio has their page on (Administration → Features). A card to a page of the studio (/create/…) or another site
 * is a full page load. */
export function createOptions(f: Features, cards: ListItem[]): Option[] {
  return cards
    .filter((c) => c.title && c.link && (!c.link.startsWith("/") || linkOn(c.link, f)))
    .map((c) => ({ key: c.id, href: c.link, icon: c.icon || "sparkle", title: c.title, text: c.text, tone: (c.tone || "brand") as Tone, reload: !c.link.startsWith("/") || c.link.startsWith("/create") }));
}

export function CreateSection({ features }: { features: Features }) {
  const check = useLockCheck(), text = useText(), cards = useList("home.cards"), opts = createOptions(features, cards);
  return (
    <section aria-labelledby="create-h" className="flex flex-col gap-3">
      <SectionHeader id="create-h" title={text("home.createTitle")} />
      {/* wide screens: every card in one row (up to 7), so none is left alone on a second row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-[repeat(var(--n),minmax(0,1fr))] [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1"
        style={{ "--n": Math.min(7, Math.max(1, opts.length)) } as React.CSSProperties}>
        {opts.map(({ key, ...o }) => (
          <CreateCard key={key} {...o} lock={PAGE_LOCK[o.href] && check && check(PAGE_LOCK[o.href]) ? lockTag(check(PAGE_LOCK[o.href]) as PlanId) : ""} />
        ))}
      </div>
    </section>
  );
}

export function TemplatesSection() {
  const { templates } = useTemplates(), text = useText();
  return (
    <section aria-labelledby="tpl-h" className="flex flex-col gap-3">
      <SectionHeader id="tpl-h" title={text("home.templatesTitle")} href="/templates" />
      <Scroller label="Popular templates" grid="md:grid md:grid-cols-6 md:overflow-visible">
        {templates.slice(0, 6).map((t) => (
          <div key={t.id} className="w-[31vw] min-w-[108px] max-w-[150px] shrink-0 snap-start md:w-auto md:max-w-none">
            <TemplateCard t={t} compact />
          </div>
        ))}
      </Scroller>
    </section>
  );
}

/** The drafts on this phone, newest first; null while they are being read. */
export function ContinueSection({ drafts, onChange }: { drafts: Draft[] | null; onChange?: () => void }) {
  const text = useText();
  async function remove(d: Draft) {
    if (await confirmAction({ title: text("reels.deleteDraftTitle", { name: d.name }), body: text("reels.deleteDraftText"), ok: text("reels.delete"), danger: true })) {
      await deleteDraft(d.id);
      onChange?.();
    }
  }
  return (
    <section aria-labelledby="cont-h" className="flex flex-col gap-3">
      <SectionHeader id="cont-h" title={text("home.continueTitle")} href={drafts?.length ? "/reels" : undefined} />
      {drafts === null ? (
        <div className="flex gap-3 overflow-hidden" role="status" aria-label="Loading your drafts">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex w-[44vw] max-w-[200px] shrink-0 flex-col gap-2 md:w-[200px]">
              <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : drafts.length ? (
        <Scroller label="Your drafts" grid="md:grid md:grid-cols-4 md:overflow-visible lg:grid-cols-5">
          {drafts.slice(0, 10).map((d, i) => {
            const href = `/create/edit?p=${encodeURIComponent(d.id)}`;
            return (
              <div key={d.id} className={`w-[44vw] max-w-[200px] shrink-0 snap-start md:w-auto md:max-w-none ${i >= 5 ? "md:hidden" : i === 4 ? "md:hidden lg:block" : ""}`}>
                <DraftCard
                  href={href}
                  name={d.name}
                  thumb={d.thumb}
                  preview={() => draftPreview(d.id)}
                  duration={clock(d.dur)}
                  edited={text("common.edited", { when: formatRelative(new Date(d.updated).toISOString()) })}
                  menu={[
                    { label: text("common.open"), icon: "scissors", href, reload: true },
                    { label: text("reels.delete"), icon: "trash", danger: true, onClick: () => void remove(d) },
                  ]}
                />
              </div>
            );
          })}
        </Scroller>
      ) : (
        <EmptyState
          icon="video"
          title={text("home.emptyTitle")}
          hint={text("home.emptyText")}
          action={
            <Button href="/create/music" reload icon="plus">
              {text("home.emptyButton")}
            </Button>
          }
        />
      )}
    </section>
  );
}

export function TipsSection() {
  const text = useText();
  // the administrator's tips (Admin → CMS → Home → Tips for Better Reels)
  const tips = useList("home.tips").filter((tip) => tip.title);
  return (
    <section aria-labelledby="tips-h" className="flex flex-col gap-3">
      <SectionHeader id="tips-h" title={text("home.tipsTitle")} />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {tips.map((tip, i) => (
          <TipCard key={tip.id} n={i + 1} icon={tip.icon || "bulb"} color={tip.color || "#d8bd7b"} title={tip.title} text={tip.text} />
        ))}
      </div>
    </section>
  );
}
