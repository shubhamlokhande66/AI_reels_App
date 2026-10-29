import { useRef, type ComponentRef } from "react";
import { router } from "expo-router";
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useApi, useText } from "@shubix/hooks";
import { Badge, Button, CreateCard, DraftCard, EmptyState, LockBadge, Page, ProBanner, Scroller, SectionHeader, TemplatePoster, TipCard, TipsBanner, colors } from "@shubix/ui-mobile";
import type { IconName, Tone } from "@shubix/ui-core";
import { linkOn } from "@shubix/core/lib/features-list";
import { templateTag, type StudioTemplate } from "@shubix/core/lib/studio-templates";
import { clock, formatRelative } from "@shubix/utils";
import { open, openTemplate } from "../lib/navigate";
import { HomeHero } from "../components/organisms/HomeHero";
import { AdBanner } from "../components/molecules/AdBanner";
import { useCredits, useDraftActions, useDrafts, useFeatures, useList, useLockCheck, usePlanNeed, useSavedReels, useTemplates } from "../lib/data";
import { mobileApi } from "../lib/api";
import type { MobileProject } from "../lib/projects";

/** Home (the website's app/page.tsx): the hero, Create Your Reel, Popular Templates, Continue Editing, Saved in My
 * Reels, Tips for Better Reels, Go Pro; the same CMS texts and lists. */
export default function HomeScreen() {
  const text = useText(), { me } = useApi(), width = useWindowDimensions().width;
  const credits = useCredits().data, signedIn = !me?.authEnabled || !!me?.user, saved = useSavedReels(signedIn);
  const paid = credits?.enabled && credits.plan !== "free";
  const page = useRef<ComponentRef<typeof ScrollView>>(null), tipsAt = useRef(0);
  return (
    <Page scrollRef={page}>
      <View className="gap-7">
        <HomeHero onCreate={() => open("/create/music")} />
        <CreateSection width={width} />
        <AdBanner place="home" />
        <TemplatesSection width={width} />
        <ContinueSection width={width} />
        {saved && saved.length > 0 && <TipsBanner title={text("home.tipsTitle")} text={text("home.tipsSub")} onPress={() => page.current?.scrollTo({ y: tipsAt.current, animated: true })} />}
        {saved && saved.length > 0 && (
          <View className="gap-3">
            <SectionHeader title={text("home.savedTitle")} more={text("home.seeAll")} onPress={() => open("/reels")} />
            <Scroller label={text("home.savedTitle")} step={templateWidth(width)}>
              {saved.slice(0, 6).map((reel) => (
                <Pressable key={reel.id} onPress={() => open("/reels")} accessibilityLabel={reel.name} style={{ width: templateWidth(width) }} className="gap-1.5">
                  <View className="aspect-[9/16] w-full overflow-hidden rounded-2xl border border-border bg-surface-2">
                    {reel.thumb && <Image source={{ uri: mobileApi.absoluteAsset(reel.thumb) }} className="h-full w-full" resizeMode="cover" />}
                    <Badge tone="dark" className="absolute bottom-2 right-2">{clock(reel.dur)}</Badge>
                  </View>
                  <Text numberOfLines={1} className="text-[13px] font-bold text-foreground">{reel.name}</Text>
                </Pressable>
              ))}
            </Scroller>
          </View>
        )}
        <AdBanner place="homeEnd" />
        <View onLayout={(e) => { tipsAt.current = e.nativeEvent.layout.y; }}><TipsSection width={width} /></View>
        {!paid && <ProBanner title={text("plan.bannerTitle")} text={text("plan.bannerText")} button={<Button size="sm" iconAfter="send" title={text("plan.bannerButton")} onPress={() => open("/pricing")} />} />}
      </View>
    </Page>
  );
}

/** A template card's width on a phone: 31% of the screen, 108–150px (the website's w-[31vw] min/max). */
const templateWidth = (width: number) => Math.min(150, Math.max(108, width * 0.31));

/** The ways to start (and My Reels): the administrator's cards (Admin → CMS → Home), as far as their page is on. Two
 * a row; the Music Reel and a last odd card take the whole row. */
function CreateSection({ width }: { width: number }) {
  const text = useText(), features = useFeatures(), lockOf = useLockCheck();
  const cards = useList("home.cards").filter((c) => c.title && c.link && (!c.link.startsWith("/") || linkOn(c.link, features)));
  const column = (width - 32 - 12) / 2;
  return (
    <View className="gap-3">
      <SectionHeader title={text("home.createTitle")} />
      <View className="flex-row flex-wrap gap-3">
        {cards.map((card, i) => {
          const music = card.link === "/create/music", locked = !!lockOf?.(card.link);
          return (
            <CreateCard key={card.id} icon={(card.icon || "sparkle") as IconName} title={card.title} text={card.text} tone={(card.tone || "brand") as Tone} big={music}
              width={music || (i === cards.length - 1 && cards.length % 2 === 1) ? width - 32 : column}
              lock={locked ? <LockBadge card label={text("plan.lockTag")} /> : undefined} onPress={() => open(card.link, locked)} />
          );
        })}
      </View>
    </View>
  );
}

function TemplatesSection({ width }: { width: number }) {
  const text = useText(), templates = useTemplates(), need = usePlanNeed(), step = templateWidth(width);
  return (
    <View className="gap-3">
      <SectionHeader title={text("home.templatesTitle")} more={text("home.seeAll")} onPress={() => open("/templates")} />
      <Scroller label={text("home.templatesTitle")} step={step}>
        {templates.slice(0, 6).map((t) => {
          const locked = !!need?.(t.plan);
          return (
            <Pressable key={t.id} style={{ width: step }} accessibilityLabel={t.name} onPress={() => openTemplate(t, locked)}>
                <TemplatePoster id={t.id} name={t.name} cover={t.cover && mobileApi.absoluteAsset(t.cover)} badge={templateTag(t, text)}
                  tag={locked ? <LockBadge card label={text("plan.lockTag")} /> : t.isNew ? <Badge tone="dark">{text("templates.newTag")}</Badge> : undefined} />
            </Pressable>
          );
        })}
      </Scroller>
    </View>
  );
}

/** The drafts on this phone, newest first: a row of cards, or the empty card with the first step. */
function ContinueSection({ width }: { width: number }) {
  const text = useText(), drafts = useDrafts(), { edit, menu } = useDraftActions(), step = Math.min(200, width * 0.44);
  return (
    <View className="gap-3">
      <SectionHeader title={text("home.continueTitle")} more={text("home.seeAll")} onPress={drafts?.length ? () => open("/reels") : undefined} />
      {drafts === null ? (
        <View className="flex-row gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => <View key={i} className="gap-2" style={{ width: step }}><View className="aspect-[4/3] rounded-2xl bg-surface-2" /><View className="h-3.5 w-2/3 rounded bg-surface-2" /><View className="h-3 w-1/2 rounded bg-surface-2" /></View>)}
        </View>
      ) : drafts.length ? (
        <Scroller label={text("home.continueTitle")} step={step}>
          {drafts.slice(0, 10).map((draft) => (
            <View key={draft.id} style={{ width: step }}>
              <DraftCard name={draft.title} thumb={draft.clips.find((c) => c.kind === "image")?.uri} duration={clock(draft.clips.reduce((sum, c) => sum + (c.end - c.start) / c.speed, 0))}
                edited={text("common.edited", { when: formatRelative(draft.updatedAt) })} onPress={() => edit(draft)} moreLabel={text("common.more")}
                onMore={() => void menu(draft)} />
            </View>
          ))}
        </Scroller>
      ) : (
        <EmptyState icon="video" title={text("home.emptyTitle")} hint={text("home.emptyText")} action={<Button icon="plus" title={text("home.emptyButton")} onPress={() => open("/create/music")} />} />
      )}
    </View>
  );
}

/** The administrator's tips (Admin → CMS → Home → Tips for Better Reels), two a row. */
function TipsSection({ width }: { width: number }) {
  const text = useText(), tips = useList("home.tips").filter((tip) => tip.title);
  return (
    <View className="gap-3">
      <SectionHeader title={text("home.tipsTitle")} />
      <View className="flex-row flex-wrap gap-2.5">
        {tips.map((tip, i) => <TipCard key={tip.id} n={i + 1} icon={(tip.icon || "bulb") as IconName} color={tip.color || "accent"} title={tip.title} text={tip.text} width={(width - 32 - 10) / 2} />)}
      </View>
    </View>
  );
}
