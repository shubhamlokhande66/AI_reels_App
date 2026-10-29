import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import RazorpayCheckout from "react-native-razorpay";
import { useApi, useText } from "@shubix/hooks";
import { Badge, Button, Card, ErrorBanner, Gold, GoldText, Icon, Page, useColors } from "@shubix/ui-mobile";
import type { Credits } from "@shubix/types";
import { rupees } from "@shubix/utils";
import { errorMessage } from "@shubix/api-client";
import { Checkout, OfferBand, PlanAction, PlanCard, PlanCompare, SectionHeading } from "../components/organisms/Pricing";
import { mobileApi } from "../lib/api";
import { useCredits, useList } from "../lib/data";
import { open } from "../lib/navigate";

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** Plans and credits (the website's app/pricing/page.tsx): open to everyone; signed in, people can buy and see their
 * credits. Every text: Admin → CMS → Pricing. */
export default function PricingScreen() {
  const text = useText(), queryClient = useQueryClient(), { me } = useApi(), look = useColors();
  const plans = useQuery({ queryKey: ["native-plans"], queryFn: mobileApi.pricing, staleTime: 300_000 });
  const offer = useQuery({ queryKey: ["offer"], queryFn: mobileApi.offer, staleTime: 60_000, retry: false }).data?.offer ?? null;
  const credits = useCredits().data, faq = useList("pricing.faq");
  const [yearly, setYearly] = useState(false), [buying, setBuying] = useState<string | null>(null), [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null), [checkout, setCheckout] = useState<{ item: string; label: string } | null>(null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const signedIn = !!me?.user || me?.authEnabled === false, mine = credits?.enabled ? credits : null;

  async function pay(item: string, label: string, coupon?: string) {
    setNotice(null); setBuying(item);
    try {
      const order = await mobileApi.createOrder(item, coupon);
      const result = await RazorpayCheckout.open({ key: order.keyId, amount: String(order.amount), currency: order.currency, name: text("checkout.name"), description: order.label || label, order_id: order.orderId,
        image: mobileApi.absoluteAsset(text("checkout.logo")), prefill: { email: order.email }, theme: { color: text("checkout.color") } });
      const updated = await mobileApi.verifyPayment({ razorpayOrderId: result.razorpay_order_id, razorpayPaymentId: result.razorpay_payment_id, razorpaySignature: result.razorpay_signature });
      queryClient.setQueryData(["native-credits"], updated);
      setCheckout(null); setNotice({ ok: true, text: text("pricing.paid", { item: label }) });
    } catch (e) {
      const failure = e as { code?: number | string; description?: string };
      if (failure.code !== "PAYMENT_CANCELLED" && failure.code !== 0) { setCheckout(null); setNotice({ ok: false, text: failure.description || errorMessage(e) }); }
    } finally { setBuying(null); }
  }

  if (plans.isLoading) return <Page><ActivityIndicator color={look.accent} /></Page>;
  if (plans.error || !plans.data) return <Page><ErrorBanner message={errorMessage(plans.error ?? new Error("Plans are not available."))} /></Page>;
  const p = plans.data, period = yearly ? "yearly" : "monthly", freeMonths = 12 - p.yearlyMonthsCharged, shown = p.plans.filter((x) => !x.hidden);
  const selectedId = picked ?? (mine && mine.plan !== "free" && shown.some((x) => x.id === mine.plan) ? mine.plan : shown.find((x) => x.highlight)?.id ?? shown[0]?.id);

  return (
    <Page>
      <View className="gap-12 pb-4">
        <View className="items-center gap-4 pt-4">
          <Badge tone="brand" className="h-8 self-center px-3.5" textClassName="text-[12.5px] uppercase tracking-[0.6px]">{text("pricing.badge")}</Badge>
          <GoldText before={text("pricing.title1")} text={text("pricing.title2")} className="text-center text-[28px] font-semibold leading-[30px] tracking-[-0.7px]" />
          <Text className="text-center text-[15.5px] leading-[25px] text-muted">{text("pricing.sub", { aiCost: p.costs.studio_ai ?? 10 })}</Text>
          <View accessibilityRole="radiogroup" className="mt-2 flex-row items-center gap-1 rounded-full border border-border bg-surface p-1.5">
            {([false, true] as const).map((y) => (
              <Pressable key={String(y)} onPress={() => setYearly(y)} accessibilityRole="radio" accessibilityState={{ checked: yearly === y }} className="h-10 flex-row items-center gap-2 overflow-hidden rounded-full px-5">
                {yearly === y && <Gold />}
                <Text className={`text-[14px] font-bold ${yearly === y ? "text-on-accent" : "text-muted"}`}>{text(y ? "pricing.yearly" : "pricing.monthly")}</Text>
                {y && freeMonths > 0 && <View className={`rounded-full px-2 py-0.5 ${yearly ? "bg-white/20" : "bg-success/15"}`}><Text className={`text-[11px] font-extrabold ${yearly ? "text-white" : "text-success"}`}>{text("pricing.monthsFree", { n: freeMonths })}</Text></View>}
              </Pressable>
            ))}
          </View>
        </View>

        {offer && <OfferBand offer={offer} />}
        {notice && (
          <View className={`-mt-6 flex-row items-center justify-center gap-2 rounded-2xl border px-4 py-3 ${notice.ok ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"}`}>
            <Icon name={notice.ok ? "check" : "warn"} size={18} stroke={2.2} color={notice.ok ? "success" : "danger"} />
            <Text className={`text-center text-[14px] font-semibold ${notice.ok ? "text-success" : "text-danger"}`}>{notice.text}</Text>
          </View>
        )}

        <View className="gap-5">
          {shown.map((plan) => {
            const item = `plan:${plan.id}:${period}`;
            return (
              <PlanCard key={plan.id} plan={plan} yearly={yearly} selected={plan.id === selectedId} onSelect={() => setPicked(plan.id)} offer={offer && offer.appliesTo !== "topups" ? offer.percent : undefined}
                action={<PlanAction plan={plan} signedIn={signedIn} paymentsOpen={p.paymentsOpen} current={!!mine && mine.plan === plan.id && plan.id !== "free"} busy={buying === item} selected={plan.id === selectedId}
                  onGo={open} onBuy={() => { setNotice(null); setCheckout({ item, label: `${plan.name} (${yearly ? "1 year" : "1 month"})` }); }} />} />
            );
          })}
        </View>

        <PlanCompare plans={shown.map((x) => x.id)} />

        <View className="gap-5">
          {mine && <MyCredits c={mine} />}
          <Card className="gap-4">
            <SectionHeading title={text("pricing.topUpTitle")} sub={text("pricing.topUpSub")} />
            <View className="gap-3">
              {p.topUps.map((topUp) => {
                const item = `topup:${topUp.id}`, sale = offer && offer.appliesTo !== "plans";
                return (
                  <View key={topUp.id} className="flex-row items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 p-4">
                    <View>
                      <View className="flex-row items-center gap-1.5"><Icon name="bolt" size={18} stroke={2.2} color="accent" /><Text className="text-[20px] font-semibold text-foreground">+{topUp.credits.toLocaleString("en-IN")}</Text></View>
                      <Text className="text-[12px] text-muted">{text("pricing.perCredit", { price: rupees(Math.round((topUp.price / topUp.credits) * 10) / 10) })}</Text>
                    </View>
                    <Button size="sm" variant="secondary" loading={buying === item} disabled={!p.paymentsOpen || !signedIn || (buying !== null && buying !== item)}
                      title={sale ? rupees(Math.round((topUp.price * (100 - offer.percent)) / 100)) : rupees(topUp.price)} onPress={() => setCheckout({ item, label: `${topUp.credits} ${text("pricing.credits")}` })} />
                  </View>
                );
              })}
            </View>
          </Card>
        </View>

        <View className="gap-5">
          <SectionHeading title={text("pricing.costsTitle")} sub={text("pricing.costsSub")} center />
          <Card className="p-2">
            {p.creditCosts.filter((c) => c.id.startsWith("studio_") || c.credits > 0).filter((c) => !["clip_reel", "version", "story_render", "preview"].includes(c.id)).map((c, i, list) => (
              <View key={c.id} className={`flex-row items-center justify-between gap-3 px-3 py-3.5 ${i < list.length - 1 ? "border-b border-border" : ""}`}>
                <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                  <View className="h-7 w-7 items-center justify-center rounded-lg bg-accent/[0.12]"><Icon name={c.credits === 0 ? "sparkle" : "bolt"} size={15} stroke={2} color="accent" /></View>
                  <Text className="min-w-0 flex-1 text-[14px] font-semibold text-foreground">{c.action}</Text>
                </View>
                <Badge tone={c.credits === 0 ? "success" : "brand"} className="h-7 px-3" textClassName="text-[12px]">{c.credits === 0 ? text("pricing.costFree") : c.credits === 1 ? text("pricing.costCredit") : text("pricing.costCredits", { n: c.credits })}</Badge>
              </View>
            ))}
          </Card>
        </View>

        <View className="gap-5">
          <SectionHeading title={text("pricing.faqTitle")} sub={text("pricing.faqSub")} center />
          <View className="gap-3">
            {faq.map(({ q, a }) => (
              <Pressable key={q} onPress={() => setOpenQuestion(openQuestion === q ? null : q)} accessibilityState={{ expanded: openQuestion === q }} className={`rounded-2xl border bg-surface px-5 ${openQuestion === q ? "border-accent/50" : "border-border"}`}>
                <View className="flex-row items-center justify-between gap-3 py-4">
                  <Text className="min-w-0 flex-1 text-[14.5px] font-bold text-foreground">{q}</Text>
                  <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-2" style={{ transform: [{ rotate: openQuestion === q ? "180deg" : "0deg" }] }}><Icon name="down" size={16} color="muted" /></View>
                </View>
                {openQuestion === q && <Text className="pb-4 text-[14px] leading-[22px] text-muted">{a}</Text>}
              </Pressable>
            ))}
          </View>
        </View>

        <View className="flex-row items-center justify-center gap-2"><Icon name="lock" size={15} color="muted" /><Text className="text-center text-[12.5px] text-muted">{text(p.paymentsOpen ? "pricing.secure" : "pricing.soon")}</Text></View>
      </View>
      <Checkout item={checkout?.item ?? null} label={checkout?.label ?? ""} busy={!!checkout && buying === checkout.item} onClose={() => setCheckout(null)} onPay={(coupon) => checkout && void pay(checkout.item, checkout.label, coupon)} />
    </Page>
  );
}

/** Your credits: the balance and plan, when it ends or renews, and the last five changes. */
function MyCredits({ c }: { c: Extract<Credits, { enabled: true }> }) {
  const text = useText();
  return (
    <Card className="gap-4">
      <View className="flex-row items-center justify-between gap-3">
        <View>
          <Text className="text-[13px] font-semibold text-muted">{text("pricing.yourCredits")}</Text>
          <View className="flex-row items-center gap-2"><Icon name="bolt" size={26} stroke={2.2} color="accent" /><Text className="text-[28px] font-semibold leading-[34px] text-foreground">{c.balance.toLocaleString("en-IN")}</Text></View>
        </View>
        <Badge tone="brand" className="h-8 px-3" textClassName="text-[12.5px]">{text("pricing.planBadge", { plan: c.planName })}</Badge>
      </View>
      <Text className="text-[12.5px] text-muted">
        {c.plan !== "free" && c.planEnds ? `${text("pricing.activeUntil", { date: day(c.planEnds) })} · ` : ""}
        {c.plan !== "free" && c.renews ? `${text("pricing.renews", { date: day(c.renews) })} · ` : ""}
        {c.extra > 0 ? text("pricing.extraLeft", { n: c.extra.toLocaleString("en-IN") }) : c.plan === "free" ? text("pricing.freeNote") : ""}
      </Text>
      {c.history.length > 0 && (
        <View>
          {c.history.slice(0, 5).map((h, i) => (
            <View key={i} className={`flex-row items-center justify-between gap-3 py-2 ${i ? "border-t border-border" : ""}`}>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[13px] text-muted">{h.reason}</Text>
              <Text className={`text-[13px] font-bold ${h.delta > 0 ? "text-success" : "text-foreground"}`}>{h.delta > 0 ? `+${h.delta.toLocaleString("en-IN")}` : h.delta < 0 ? `−${Math.abs(h.delta).toLocaleString("en-IN")}` : "0"}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
