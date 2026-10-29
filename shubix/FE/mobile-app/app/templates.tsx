import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useText } from "@shubix/hooks";
import { Badge, Button, Chip, EmptyState, Icon, LockBadge, Page, Paint, SearchBox, SectionHeader, TemplateCard, mix, useColors } from "@shubix/ui-mobile";
import { groupsOf, lookName, templateMeta, templateTag, type StudioTemplate } from "@shubix/core/lib/studio-templates";
import { PlanGate } from "../components/templates/PlanGate";
import { usePlanNeed, useTemplates } from "../lib/data";
import { mobileApi } from "../lib/api";
import { openTemplate } from "../lib/navigate";

/** Templates (the website's app/templates/page.tsx): the ready-made Reels by group, searchable and filtered by group
 * (or the new ones); each opens the Create flow with it picked. Every text: Admin → CMS → Templates. */
export default function TemplatesScreen() {
  return <PlanGate href="/templates"><Templates /></PlanGate>;
}

function Templates() {
  const text = useText(), templates = useTemplates(), need = usePlanNeed(), width = useWindowDimensions().width, look = useColors();
  const [q, setQ] = useState(useLocalSearchParams<{ q?: string }>().q ?? ""), [group, setGroup] = useState("all");
  const s = q.trim().toLowerCase();
  const found = (x: StudioTemplate) => !s || [x.name, x.text, lookName(x), x.group, x.kind].join(" ").toLowerCase().includes(s);
  const inGroup = (x: StudioTemplate) => group === "all" || (group === "new" ? !!x.isNew : x.group === group);
  const shown = templates.filter((x) => found(x) && inGroup(x)), groups = groupsOf(templates);
  const chips = [
    { id: "all", label: text("templates.all"), n: templates.length },
    ...(templates.some((x) => x.isNew) ? [{ id: "new", label: text("templates.newChip"), n: templates.filter((x) => x.isNew).length }] : []),
    ...groups.map((g) => ({ id: g, label: g, n: templates.filter((x) => x.group === g).length })),
  ];
  const column = (width - 32 - 12) / 2;
  const grid = (list: StudioTemplate[]) => (
    <View className="flex-row flex-wrap gap-x-3 gap-y-5">
      {list.map((t) => {
        const locked = !!need?.(t.plan);
        return (
          <Pressable key={t.id} style={{ width: column }} accessibilityLabel={t.name} onPress={() => openTemplate(t, locked)}>
            <TemplateCard id={t.id} name={t.name} cover={t.cover && mobileApi.absoluteAsset(t.cover)} badge={templateTag(t, text)} meta={templateMeta(t)} text={t.text}
              tag={locked ? <LockBadge card label={text("plan.lockTag")} /> : t.isNew ? <Badge tone="dark">{text("templates.newTag")}</Badge> : undefined} />
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <Page>
      <View className="gap-6 pb-4">
        <View className="overflow-hidden rounded-[24px] border border-accent/20 px-4 py-5">
          <Paint paint={{ angle: 125, stops: [mix(look.accent, look.surface, 0.1), [look.surface, 55], mix(look.accent, look.surface, 0.04)] }} />
          <View className="absolute -right-8 -top-16 h-48 w-48 rounded-full bg-accent/10" />
          <View className="gap-4">
            <View className="gap-2">
              <View className="flex-row items-center gap-2"><View className="h-px w-5 bg-accent/70" /><Text className="text-[9px] font-extrabold uppercase tracking-[1.8px] text-accent">{text("templates.eyebrow")}</Text></View>
              <Text className="text-[13.5px] leading-[19.6px] text-muted">{text("templates.sub")}</Text>
            </View>
            <View className="flex-row items-center gap-2 self-start rounded-full border border-accent/20 bg-surface/65 px-3 py-2">
              <Icon name="reels" size={14} color="accent" />
              <Text className="text-[10px] font-semibold text-muted">{text("templates.count", { n: templates.length })}</Text>
            </View>
          </View>
        </View>
        <View className="gap-3 rounded-[20px] border border-accent/10 bg-surface/55 p-3">
          <SearchBox value={q} onChange={setQ} label={text("templates.search")} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" accessibilityLabel={text("nav.templates")}>
            {chips.map((c) => <Chip key={c.id} tall on={group === c.id} onPress={() => setGroup(c.id)} label={c.label} count={c.n} icon={c.id === "new" ? <Icon name="sparkle" size={13} color="accent" /> : undefined} />)}
          </ScrollView>
        </View>
        {!shown.length ? (
          <EmptyState icon="search" title={text("templates.none", { q: q.trim() || chips.find((c) => c.id === group)?.label || "" })} hint={text("templates.noneHint")}
            action={<Button variant="secondary" title={text("templates.clear")} onPress={() => { setQ(""); setGroup("all"); }} />} />
        ) : group === "all" && !s ? (
          groups.map((g, i) => {
            const list = templates.filter((x) => x.group === g);
            return (
              <View key={g} className={`gap-3.5 ${i ? "border-t border-accent/10 pt-5" : ""}`}>
                <View className="flex-row items-center justify-between gap-3">
                  <SectionHeader title={g} />
                  <Pressable onPress={() => setGroup(g)} className="rounded-full border border-border/70 bg-surface/60 px-3 py-1.5 active:border-accent/40">
                    <Text className="text-[10.5px] font-semibold text-muted">{text("templates.count", { n: list.length })}</Text>
                  </Pressable>
                </View>
                {grid(list)}
              </View>
            );
          })
        ) : (
          <View className="gap-3.5">
            <Text className="text-[10.5px] font-semibold uppercase tracking-[1.4px] text-muted">{text("templates.count", { n: shown.length })}</Text>
            {grid(shown)}
          </View>
        )}
      </View>
    </Page>
  );
}
