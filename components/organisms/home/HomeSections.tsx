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
import { linkOn, type Features } from "@/lib/features-list";
import { formatRelative } from "@/lib/format";
import { STUDIO_TEMPLATES } from "@/lib/studio-templates";
import type { Tone } from "@/lib/ui";

/** Home's sections (UI/ design), each one reusable on its own: Create Your Reel, Popular Templates, Continue Editing,
 * Tips for Better Reels. */

type Option = { href: string; icon: string; title: string; text: string; tone: Tone; reload?: boolean };

/** The six ways to start, as far as this studio has them on (Administration → Features). */
export function createOptions(f: Features): Option[] {
  return [
    { href: "/create/music", icon: "music", title: "Music Reel", text: "Sync with Music", tone: "music", reload: true },
    { href: "/create/talking", icon: "mic", title: "Talking Reel", text: "Vlogs & Tutorials", tone: "talk", reload: true },
    { href: "/create/photo", icon: "image", title: "Photo Reel", text: "Bring Photos to Life", tone: "photo", reload: true },
    { href: "/create/story", icon: "book", title: "Story Maker", text: "Text to Video", tone: "story", reload: true },
    { href: "/templates", icon: "grid", title: "Use a Template", text: "Ready-made Styles", tone: "template" },
    { href: "/reels", icon: "video", title: "My Reels", text: "Watch & share", tone: "recreate" },
  ].filter((o) => linkOn(o.href, f)) as Option[];
}

export function CreateSection({ features }: { features: Features }) {
  return (
    <section aria-labelledby="create-h" className="flex flex-col gap-3">
      <SectionHeader id="create-h" title="Create Your Reel" href="/templates" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-3">
        {createOptions(features).map((o) => (
          <CreateCard key={o.title} {...o} />
        ))}
      </div>
    </section>
  );
}

export function TemplatesSection() {
  return (
    <section aria-labelledby="tpl-h" className="flex flex-col gap-3">
      <SectionHeader id="tpl-h" title="Popular Templates" href="/templates" />
      <Scroller label="Popular templates" grid="md:grid md:grid-cols-6 md:overflow-visible">
        {STUDIO_TEMPLATES.slice(0, 6).map((t) => (
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
  async function remove(d: Draft) {
    if (await confirmAction({ title: `Delete “${d.name}”?`, body: "The draft and its clips are removed from this phone.", ok: "Delete", danger: true })) {
      await deleteDraft(d.id);
      onChange?.();
    }
  }
  return (
    <section aria-labelledby="cont-h" className="flex flex-col gap-3">
      <SectionHeader id="cont-h" title="Continue Editing" href={drafts?.length ? "/reels" : undefined} />
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
                  edited={`Edited ${formatRelative(new Date(d.updated).toISOString())}`}
                  menu={[
                    { label: "Open", icon: "scissors", href, reload: true },
                    { label: "Delete", icon: "trash", danger: true, onClick: () => void remove(d) },
                  ]}
                />
              </div>
            );
          })}
        </Scroller>
      ) : (
        <EmptyState
          icon="video"
          title="No Reels yet"
          hint="Pick a song and a few clips: your first Reel is ready in seconds, cut to the beat."
          action={
            <Button href="/create/music" reload icon="plus">
              Make your first Reel
            </Button>
          }
        />
      )}
    </section>
  );
}

const TIPS = [
  { icon: "bulb", color: "#facc15", title: "Add a strong hook", text: "First 2 seconds matter the most." },
  { icon: "music", color: "#e879f9", title: "Use trending music", text: "That matches your vibe." },
  { icon: "play", color: "#c026d3", title: "Keep it short and engaging", text: "15–30 seconds works best." },
  { icon: "text", color: "#f472b6", title: "Add text and captions", text: "So everyone can understand." },
];

export function TipsSection() {
  return (
    <section aria-labelledby="tips-h" className="flex flex-col gap-3">
      <SectionHeader id="tips-h" title="Tips for Better Reels" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {TIPS.map((t, i) => (
          <TipCard key={t.title} n={i + 1} {...t} />
        ))}
      </div>
    </section>
  );
}
