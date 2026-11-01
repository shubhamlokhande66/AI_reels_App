import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useText } from "@shubix/hooks";
import { Button, ErrorBanner, Gold, Icon, IconTile, Input, SidePanel, colors } from "@shubix/ui-mobile";
import { planLook, type IconName } from "@shubix/ui-core";
import { DEFAULT_LOCKS, PLANS, PLAN_NAME, planRank, type PlanId } from "@shubix/core/lib/plan-locks";
import type { Offer, Pricing, Quote } from "@shubix/types";
import { rupees, timeLeft } from "@shubix/utils";
import { errorMessage } from "@shubix/api-client";
import { mobileApi } from "../../lib/api";

/** The Pricing page's parts (the website's components/organisms/pricing and molecules/OfferStrip), the same sizes. */
export type Plan = Pricing["plans"][number];

/** A page section's heading: the title and one line under it, centred or not (the website's SectionHeading). */
export const SectionHeading = ({ title, sub, center = false }: { title: string; sub?: string; center?: boolean }) => (
  <View className={`gap-1 ${center ? "items-center" : ""}`}>
    <Text accessibilityRole="header" className={`text-[19px] font-semibold tracking-[-0.29px] text-foreground ${center ? "text-center" : ""}`}>{title}</Text>
    {sub && <Text className={`text-[14px] text-muted ${center ? "text-center" : ""}`}>{sub}</Text>}
  </View>
);

/** One plan: its name and line, the price for the period, the credits, the button, and everything it includes. The
 * selected one has the gold edge and a check; the popular one the "Most popular" tag. */
export function PlanCard({ plan, yearly, action, selected, onSelect, offer }: { plan: Plan; yearly: boolean; action: ReactNode; selected: boolean; onSelect: () => void; offer?: number }) {
  const text = useText(), free = plan.monthly === 0, price = free ? 0 : yearly ? plan.yearly : plan.monthly;
  const perMonth = yearly && !free ? Math.round(plan.yearly / 12) : null, look = planLook(plan.id), sale = !!offer && !free;
  const body = (
    <View className="gap-5 rounded-[22px] bg-surface p-6">
      {selected && <View className="absolute right-4 top-4 h-6 w-6 items-center justify-center overflow-hidden"><Gold /><Icon name="check" size={13} stroke={3} color="onAccent" /></View>}
      <View className="flex-row items-center gap-3 pr-7">
        <IconTile icon={look.icon as IconName} tone={look.tone} size={44} />
        <View className="min-w-0 flex-1">
          <Text className="text-[17px] font-semibold leading-[21px] text-foreground">{plan.name}</Text>
          <Text className="text-[13px] leading-[17px] text-muted">{plan.tagline}</Text>
        </View>
      </View>
      <View className="gap-1">
        {sale && <View className="mb-1 self-start overflow-hidden rounded-full px-2.5 py-0.5"><Gold /><Text className="text-[11px] font-bold text-on-accent">{text("pricing.offerTag", { percent: offer })}</Text></View>}
        <View className="flex-row flex-wrap items-baseline gap-x-2">
          <Text className="text-[34px] font-bold leading-[36px] tracking-[-1px] text-foreground">{rupees(sale ? Math.round((price * (100 - offer!)) / 100) : price)}</Text>
          {sale && <Text className="text-[16px] font-semibold text-muted line-through">{rupees(price)}</Text>}
          {!free && <Text className="text-[14px] font-semibold text-muted">{text(yearly ? "pricing.perYear" : "pricing.perMonth")}</Text>}
        </View>
        <Text className="h-5 text-[12.5px] text-muted">{free ? text("pricing.freeForever") : perMonth ? text("pricing.billedYearly", { price: rupees(perMonth) }) : text("pricing.billedMonthly")}</Text>
      </View>
      <View className={`flex-row items-start gap-2 rounded-xl px-3 py-2 ${selected ? "bg-accent/10" : "bg-surface-2"}`}>
        <Icon name="bolt" size={15} stroke={2.2} color="accent" />
        <Text className={`min-w-0 flex-1 text-[12.5px] leading-[17px] ${selected ? "text-foreground" : "text-muted"}`}>
          {plan.credits > 0 && <Text className="font-extrabold text-foreground">{plan.credits.toLocaleString("en-IN")} {text("pricing.credits")} </Text>}
          {plan.credits > 0 ? plan.creditsNote : plan.creditsNote.replace(/^./, (c) => c.toUpperCase())}
        </Text>
      </View>
      {action}
      <View className="gap-2.5 border-t border-border pt-5">
        {plan.features.map((feature) => (
          <View key={feature} className="flex-row items-start gap-2.5">
            <View className={`mt-px h-[18px] w-[18px] items-center justify-center rounded-full ${selected ? "bg-accent" : "bg-accent/15"}`}><Icon name="check" size={11} stroke={3} color={selected ? "onAccent" : "accent"} /></View>
            <Text className="min-w-0 flex-1 text-[13.5px] leading-[18px] text-foreground">{feature}</Text>
          </View>
        ))}
      </View>
    </View>
  );
  return (
    <Pressable onPress={onSelect} accessibilityLabel={plan.name} accessibilityState={{ selected }} className="mt-3.5">
      <View className={`overflow-hidden rounded-3xl p-[2px] ${selected ? "" : "bg-border"}`}>{selected && <Gold />}{body}</View>
      {plan.highlight && (
        <View className="absolute -top-3.5 self-center overflow-hidden rounded-full px-3.5 py-1"><Gold /><Text className="text-[11.5px] font-extrabold uppercase tracking-[0.6px] text-on-accent">{text("pricing.popular")}</Text></View>
      )}
    </Pressable>
  );
}

/** The plan's button, as far as this person and this studio allow (sign in, payments not open yet, your plan…). */
export function PlanAction({ plan, signedIn, paymentsOpen, current, busy, selected, onBuy, onGo }: { plan: Plan; signedIn: boolean; paymentsOpen: boolean; current: boolean; busy: boolean; selected: boolean; onBuy: () => void; onGo: (href: string) => void }) {
  const text = useText(), variant = selected ? "primary" : "secondary";
  if (plan.monthly === 0) return <Button full variant="secondary" title={text(signedIn ? "pricing.makeReel" : "pricing.startFree")} onPress={() => onGo(signedIn ? "/" : "/login")} />;
  if (!paymentsOpen) return <Button full variant={variant} disabled title={text(current ? "pricing.currentPlan" : "pricing.opensSoon")} onPress={() => {}} />;
  if (!signedIn) return <Button full variant={variant} title={text("pricing.signInFor", { plan: plan.name })} onPress={() => onGo("/login")} />;
  return <Button full variant={variant} loading={busy} iconAfter={busy ? undefined : "send"} title={busy ? text("pricing.opening") : text(current ? "pricing.extend" : "pricing.choose", { plan: plan.name })} onPress={onBuy} />;
}

/** "What each plan unlocks", made from the administrator's plan locks: libraries show how many items each plan opens;
 * tools and export rules ✓ or the value. The names stay while the plans scroll sideways. */
const RES: Record<string, string> = { "720": "720p", "1080": "1080p", "4k": "4K" };
export function PlanCompare({ plans }: { plans: string[] }) {
  const text = useText(), cols = PLANS.filter((p) => plans.includes(p));
  const locks = useQuery({ queryKey: ["plan-locks"], queryFn: mobileApi.planLocks, staleTime: 300_000, retry: false }).data ?? DEFAULT_LOCKS;
  const opens = (p: PlanId, plan: PlanId) => planRank(plan) <= planRank(p), isTools = (id: string) => id === "studio" || id === "tool";
  const rows: [string, (p: PlanId) => string][] = [
    ...locks.groups.filter((g) => !isTools(g.id)).map((g): [string, (p: PlanId) => string] => [g.name, (p) => { const n = g.items.filter((it) => opens(p, it.plan)).length; return n === g.items.length ? `All ${n}` : `${n} of ${g.items.length}`; }]),
    ...locks.groups.filter((g) => isTools(g.id)).flatMap((g) => g.items).map((it): [string, (p: PlanId) => string] => [`${it.plan !== "free" ? "👑 " : ""}${it.name}`, (p) => (opens(p, it.plan) ? "✓" : "—")]),
    [text("pricing.rowQuality"), (p) => RES[locks.export[p].maxRes]],
    [text("pricing.row60"), (p) => (locks.export[p].fps60 ? "✓" : "—")],
    [text("pricing.rowWatermark"), (p) => (locks.export[p].noWatermark ? "✓" : "—")],
  ];
  const cell = "w-[64px] px-1.5 py-2 text-center text-[12.5px] text-foreground";
  return (
    <View className="gap-3 rounded-2xl border border-border bg-surface p-4">
      <View><Text className="text-[19px] font-semibold tracking-[-0.29px] text-foreground">{text("pricing.compareTitle")}</Text><Text className="text-sm text-muted">{text("pricing.compareSub")}</Text></View>
      <View className="flex-row">
        <View className="min-w-0 flex-1">
          <View className="h-9 border-b border-border" />
          {rows.map(([name], i) => <Text key={i} className={`min-h-[36px] py-2 pl-1 pr-2 text-[12.5px] font-medium leading-[17px] text-foreground ${i < rows.length - 1 ? "border-b border-border" : ""}`}>{name}</Text>)}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View className="h-9 flex-row border-b border-border">{cols.map((p) => <Text key={p} className={`${cell} font-bold`}>{PLAN_NAME[p]}</Text>)}</View>
            {rows.map(([, value], i) => <View key={i} className={`min-h-[36px] flex-row items-center ${i < rows.length - 1 ? "border-b border-border" : ""}`}>{cols.map((p) => <Text key={p} className={cell}>{value(p)}</Text>)}</View>)}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

/** Before paying: the price, a sale running, your coupon and the total, worked out by the server; Pay opens the
 * payment window with that total. */
export function Checkout({ item, label, onClose, onPay, busy }: { item: string | null; label: string; onClose: () => void; onPay: (coupon?: string) => void; busy: boolean }) {
  const text = useText();
  const [quote, setQuote] = useState<Quote | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [code, setCode] = useState(""), [applied, setApplied] = useState<string | undefined>(), [codeError, setCodeError] = useState("");
  const check = async (coupon?: string) => {
    if (!item) return;
    setLoading(true); setError(null);
    try { const r = await mobileApi.quote(item, coupon); setQuote(r); if (coupon && r.couponError) { setCodeError(r.couponError); setApplied(undefined); } else { setCodeError(""); setApplied(coupon); } }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  };
  useEffect(() => { setQuote(null); setCode(""); setApplied(undefined); setCodeError(""); if (item) void check(); }, [item]); // eslint-disable-line react-hooks/exhaustive-deps -- a new item: priced afresh
  const row = (name: ReactNode, value: string, tone = "text-foreground") => <View className="flex-row items-center justify-between gap-3"><Text className={`min-w-0 flex-1 text-[13.5px] ${tone}`}>{name}</Text><Text className={`text-[13.5px] ${tone}`}>{value}</Text></View>;
  return (
    <SidePanel open={!!item} onClose={onClose} title={text("pricing.checkoutTitle")} where={label} closeLabel={text("common.close")}>
      {error && <ErrorBanner message={error} />}
      {!quote && !error && <ActivityIndicator color={colors.accent} />}
      {quote && (
        <View className="gap-4">
          <View className="gap-2.5 rounded-2xl border border-border bg-surface p-4">
            {row(text("pricing.checkoutPrice"), rupees(quote.base))}
            {quote.offer && row(`${text("pricing.checkoutOffer", { title: quote.offer.title })} · ${quote.offer.percent}%`, `−${rupees(quote.offer.off)}`, "text-success")}
            {quote.coupon && row(`${text("pricing.checkoutCoupon", { code: quote.coupon.code })} · ${quote.coupon.label}`, `−${rupees(quote.coupon.off)}`, "text-success")}
            <View className="my-0.5 h-px bg-border" />
            <View className="flex-row items-center justify-between"><Text className="text-[15px] font-bold text-foreground">{text("pricing.checkoutTotal")}</Text><Text className="text-[22px] font-bold text-foreground">{rupees(quote.final)}</Text></View>
          </View>
          <View className="gap-1.5">
            <Text className="text-[12px] font-semibold text-muted">{text("pricing.couponLabel")}</Text>
            <View className="flex-row items-center gap-2">
              <View className="flex-1"><Input value={code} onChangeText={(v) => { setCode(v.toUpperCase()); setCodeError(""); }} placeholder={text("pricing.couponPlaceholder")} autoCapitalize="characters" autoComplete="off" editable={!applied} invalid={!!codeError} /></View>
              {applied
                ? <Button variant="secondary" title={text("pricing.couponRemove")} onPress={() => { setCode(""); void check(); }} />
                : <Button variant="secondary" loading={loading && !!code} disabled={!code.trim()} title={text("pricing.couponApply")} onPress={() => void check(code.trim().toUpperCase())} />}
            </View>
            {!!codeError && <Text className="text-[12px] text-danger">{codeError}</Text>}
            {applied && quote.coupon && <Text className="text-[12px] text-success">{text("pricing.couponApplied", { label: quote.coupon.label })}</Text>}
          </View>
          <View className="flex-row items-start gap-2"><Icon name="shield" size={14} color="muted" /><Text className="min-w-0 flex-1 text-[12px] text-muted">{text("pricing.secure")}</Text></View>
          <Button size="lg" full icon="bolt" loading={busy} disabled={loading} title={text("pricing.payNow", { price: rupees(quote.final) })} onPress={() => onPay(applied)} />
        </View>
      )}
    </SidePanel>
  );
}

/** A sale running (Admin → Marketing → Offers): its tag, name, line and when it ends (the website's OfferStrip band). */
export function OfferBand({ offer }: { offer: Offer }) {
  const text = useText(), when = timeLeft(offer.ends);
  return (
    <View className="flex-row flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3">
      <View className="flex-row items-center gap-1.5 overflow-hidden rounded-full px-2.5 py-0.5"><Gold /><Icon name="sparkle" size={12} color="onAccent" /><Text className="text-[11.5px] font-bold text-on-accent">{text("pricing.offerTag", { percent: offer.percent })}</Text></View>
      <Text className="text-center text-[13.5px] text-foreground">
        <Text className="font-semibold">{offer.title}</Text>
        <Text className="text-foreground/80">{offer.banner ? ` · ${offer.banner}` : ""}{offer.audience === "new" ? ` · ${text("pricing.offerNew")}` : ""}{when ? ` · ${text("pricing.offerEnds", { when })}` : ""}</Text>
      </Text>
    </View>
  );
}
