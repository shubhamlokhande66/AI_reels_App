"use client";

import { AdSlot } from "@/components/organisms/AdSlot";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DurationTag, Photo, Skeleton } from "@/components/atoms";
import { ProBanner, Scroller, SectionHeader, TipsBanner } from "@/components/molecules";
import { HomeHero } from "@/components/organisms/home/HomeHero";
import { ContinueSection, CreateSection, TemplatesSection, TipsSection } from "@/components/organisms/home/HomeSections";
import { useCredits, useFeatures, useMe, useT } from "@/hooks/useApi";
import { listCloudReels, type CloudReel } from "@/lib/cloudReels";
import { clock, useDrafts } from "@/lib/drafts";

// Home (UI/ design "Shubix AI Reels Creator Dashboard"): the hero, Create Your Reel, Popular Templates, Continue
// Editing, Tips, Go Pro.

function useSaved(on: boolean) {
  const [reels, setReels] = useState<CloudReel[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    listCloudReels().then(
      (d) => live && setReels(d.reels),
      () => live && setReels([]),
    );
    return () => {
      live = false;
    };
  }, [on]);
  return reels;
}

/** The Reels saved in My Reels (cloud), as a row. */
function SavedSection({ reels }: { reels: CloudReel[] | null }) {
  const t = useT();
  if (reels === null) return <Skeleton className="h-40 w-full" />;
  if (!reels.length) return null;
  return (
    <section aria-labelledby="saved-h" className="flex flex-col gap-3">
      <SectionHeader id="saved-h" title={t("home.savedTitle")} href="/reels?tab=saved" />
      <Scroller label="Saved Reels" grid="md:grid md:grid-cols-6 md:overflow-visible">
        {reels.slice(0, 6).map((r) => (
          <Link key={r.id} href="/reels?tab=saved" className="group flex w-[31vw] max-w-[150px] shrink-0 snap-start flex-col gap-1.5 md:w-auto md:max-w-none" title={r.name}>
            <Photo className="aspect-[9/16] w-full rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- a small picture kept with the Reel */}
              {r.thumb && <img src={r.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />}
              <DurationTag>{clock(r.dur)}</DurationTag>
            </Photo>
            <b className="truncate text-[13px] group-hover:text-accent">{r.name}</b>
          </Link>
        ))}
      </Scroller>
    </section>
  );
}

export default function Home() {
  const features = useFeatures();
  const me = useMe();
  const credits = useCredits();
  const [reload, setReload] = useState(0);
  const drafts = useDrafts(reload);
  const signedIn = !me.data?.authEnabled || !!me.data?.user;
  const saved = useSaved(signedIn);
  const create = { href: "/create/music", reload: true };
  const paid = credits.data?.enabled && credits.data.plan !== "free";

  return (
    <div className="flex flex-col gap-7 md:gap-9">
      <HomeHero {...create} />
      <CreateSection features={features} />
      <AdSlot place="home" />
      <TemplatesSection />
      <ContinueSection drafts={drafts} onChange={() => setReload((n) => n + 1)} />
      {/* the shortcut to the tips, when Saved Reels stand between (else the tips are right here) */}
      {saved && saved.length > 0 && <TipsBanner />}
      <SavedSection reels={saved} />
      <TipsSection />
      {!paid && <ProBanner />}
    </div>
  );
}
