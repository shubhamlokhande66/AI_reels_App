import { useState } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useText } from "@shubix/hooks";
import { Button, Card, EmptyState, ErrorBanner, Field, Gold, Heading, Icon, Input, Page, Paint, StatTile, confirmAction, useColors } from "@shubix/ui-mobile";
import type { IconName } from "@shubix/ui-core";
import type { MyMarketing } from "@shubix/types";
import { errorMessage } from "@shubix/api-client";
import { AdBanner } from "../components/molecules/AdBanner";
import { mobileApi } from "../lib/api";
import { useCredits } from "../lib/data";

/** Invite & earn (the website's app/rewards/page.tsx): invite friends (both get credits), send credits to a friend by
 * @username, and your username. The affiliate program (cash payouts) is on the website only. Every rule is the
 * administrator's (Admin → Marketing); every word is in the CMS. */
export default function RewardsScreen() {
  const text = useText(), look = useColors(), credits = useCredits().data;
  const q = useQuery({ queryKey: ["my-marketing"], queryFn: mobileApi.marketing, retry: false });
  if (q.isLoading) return <Page><ActivityIndicator color={look.accent} /></Page>;
  if (credits && !credits.enabled) return <Page><EmptyState icon="gift" title={text("nav.rewards")} hint={text("rewards.off")} /></Page>;
  if (q.error || !q.data) return <Page><ErrorBanner message={errorMessage(q.error ?? new Error("Not available."))} /></Page>;
  return (
    <Page>
      <View className="gap-5">
        <Text className="text-[13.5px] leading-[19.6px] text-muted">{text("rewards.sub")}</Text>
        <Invite m={q.data} />
        <SendCredits m={q.data} />
        <Username m={q.data} />
        <AdBanner place="rewards" />
      </View>
    </Page>
  );
}

/** A card's head: its icon, title and line. */
const Head = ({ icon, title, children, gold = false }: { icon: IconName; title: string; children: React.ReactNode; gold?: boolean }) => (
  <View className="flex-row items-start gap-3">
    <View className={`items-center justify-center overflow-hidden ${gold ? "h-11 w-11 rounded-2xl" : "h-10 w-10 rounded-xl bg-accent/[0.12]"}`}>{gold && <Gold />}<Icon name={icon} size={gold ? 22 : 19} color={gold ? "onAccent" : "accent"} /></View>
    <View className="min-w-0 flex-1"><Heading>{title}</Heading>{children}</View>
  </View>
);
const Result = ({ msg }: { msg: { ok: boolean; text: string } | null }) => msg && <Text className={`text-[12.5px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</Text>;

function Invite({ m }: { m: MyMarketing }) {
  const text = useText(), [copied, setCopied] = useState(false), r = m.referral;
  const link = mobileApi.absoluteAsset(m.link);
  const step = (s: string) => text(s === "signup" ? "rewards.whenSignup" : s === "purchase" ? "rewards.whenPurchase" : "rewards.whenVerified");
  const copy = async () => { await Clipboard.setStringAsync(link); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  return (
    <Card className="gap-4 overflow-hidden p-5">
      <View className="absolute -right-16 -top-20 h-56 w-56"><Paint paint={{ angle: 0, stops: ["transparent"], glows: [[50, 50, 50, "rgba(216,189,123,.22)"]] }} /></View>
      <Head icon="gift" title={text("rewards.inviteTitle")} gold>
        <Text className="mt-1 text-[13px] text-muted">{r.on ? text("rewards.inviteLine2", { you: r.inviterCredits, friend: r.inviteeCredits, friendWhen: step(r.inviteeOn), youWhen: step(r.inviterOn) }) : text("rewards.inviteOff")}</Text>
        {r.on && !m.ai.planAi && (
          <View className="mt-2 flex-row items-center gap-1.5 self-start rounded-full bg-accent/10 px-2.5 py-1">
            <Icon name="sparkle" size={13} color="accent" />
            <Text className="text-[12px] font-semibold text-accent">{m.ai.freeWithCredits ? text("rewards.creditsFreeAi", { n: m.ai.reelCost }) : text("rewards.creditsKept")}</Text>
          </View>
        )}
      </Head>
      {r.on && (
        <>
          <Field label={text("rewards.yourLink")}>
            <View className="gap-2">
              <Input value={link} editable={false} selectTextOnFocus className="font-mono text-[13px] text-foreground" />
              <View className="flex-row gap-2">
                <View className="flex-1"><Button full icon={copied ? "check" : "copy"} title={copied ? text("rewards.copied") : text("rewards.copy")} onPress={() => void copy()} /></View>
                <View className="flex-1"><Button full variant="secondary" icon="share" title={text("rewards.whatsapp")} onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text("rewards.shareText", { link }))}`)} /></View>
              </View>
            </View>
          </Field>
          <View className="gap-2.5">
            <StatTile value={r.invited} label={text("rewards.invited")} />
            <StatTile value={r.rewarded} label={text("rewards.rewarded")} />
            <StatTile value={r.earned} label={text("rewards.earned")} />
          </View>
        </>
      )}
    </Card>
  );
}

function SendCredits({ m }: { m: MyMarketing }) {
  const text = useText(), queryClient = useQueryClient(), s = m.share;
  const [to, setTo] = useState(""), [amount, setAmount] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const left = Math.max(0, s.dailyMax - s.sentToday), n = Number(amount), name = to.trim().replace(/^@/, "");
  const valid = name.length >= 3 && Number.isInteger(n) && n >= s.min && n <= Math.min(s.max, left);
  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await mobileApi.sendCredits(name, n);
      setMsg({ ok: true, text: text("rewards.sent", { n: r.sent, to: r.to }) }); setTo(""); setAmount("");
      void queryClient.invalidateQueries({ queryKey: ["native-credits"] }); void queryClient.invalidateQueries({ queryKey: ["my-marketing"] });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  return (
    <Card className="gap-4 p-5">
      <Head icon="send" title={text("rewards.sendTitle")}>
        <Text className="mt-1 text-[12.5px] text-muted">{s.on ? text("rewards.sendLine", { min: s.min, max: s.max, left }) : text("rewards.sendOff")}</Text>
        {s.on && s.source === "extra" && <Text className="mt-1 text-[12px] text-muted">{text("rewards.sendExtraOnly")}</Text>}
      </Head>
      {s.on && (
        <View className="gap-3">
          <Field label={text("rewards.to")}><Input value={to} onChangeText={setTo} placeholder={text("rewards.toPlaceholder")} autoComplete="off" autoCapitalize="none" /></Field>
          <Field label={text("rewards.amount")}><Input value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder={String(s.min)} /></Field>
          <Button full icon="send" loading={busy} disabled={!valid} title={busy ? text("rewards.sending") : text("rewards.send")}
            onPress={async () => { if (await confirmAction({ title: text("rewards.confirm", { n, to: name }), ok: text("rewards.send") })) void send(); }} />
          <Result msg={msg} />
        </View>
      )}
    </Card>
  );
}

function Username({ m }: { m: MyMarketing }) {
  const text = useText(), queryClient = useQueryClient();
  const [value, setValue] = useState(m.username), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const clean = value.trim().replace(/^@/, "").toLowerCase(), valid = /^[a-z0-9](?:[a-z0-9._]{1,18}[a-z0-9])$/.test(clean);
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await mobileApi.setUsername(clean); setMsg({ ok: true, text: text("rewards.userSaved") }); void queryClient.invalidateQueries({ queryKey: ["my-marketing"] }); }
    catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  return (
    <Card className="gap-4 p-5">
      <Head icon="user" title={text("rewards.userTitle")}><Text className="mt-1 text-[12.5px] text-muted">{text("rewards.userLine")}</Text></Head>
      <View className="flex-row items-center gap-2">
        <View className="flex-1"><Input icon={<Text className="text-[14px] text-muted">@</Text>} value={value.replace(/^@/, "")} onChangeText={(v) => { setValue(v); setMsg(null); }} autoCapitalize="none" autoComplete="off" accessibilityLabel={text("rewards.userTitle")} invalid={!valid} /></View>
        <Button variant="secondary" loading={busy} disabled={!valid || clean === m.username} title={text("rewards.userSave")} onPress={() => void save()} />
      </View>
      <Result msg={msg} />
    </Card>
  );
}
