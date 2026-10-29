import { useState, type ReactNode } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi, useSignOut, useText } from "@shubix/hooks";
import { Avatar, Badge, Button, Card, ErrorBanner, Field, Heading, Icon, Input, Page, Paint, PasswordInput, SidePanel, colors } from "@shubix/ui-mobile";
import type { IconName } from "@shubix/ui-core";
import { passwordOk } from "@shubix/validations";
import { errorMessage } from "@shubix/api-client";
import { ThemeChoice } from "../components/molecules/ThemeToggle";
import { AdBanner } from "../components/molecules/AdBanner";
import { mobileApi } from "../lib/api";
import { useCredits } from "../lib/data";
import { open } from "../lib/navigate";

const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
type PanelId = "password" | "sessions" | "payments" | "delete";
/** A result line under a form: green when it worked, red when not. */
const Note = ({ ok, children }: { ok: boolean; children: ReactNode }) =>
  <Text className={`rounded-xl border px-3 py-2 text-[13px] font-semibold ${ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>{children}</Text>;

/** My account (the website's app/account/page.tsx): who you are and your plan, your credits, the account's settings
 * as rows (each opens its panel: password, devices, payments, delete), and Sign out. Every text: Admin → CMS → My account. */
export default function AccountScreen() {
  const text = useText(), { me } = useApi(), credits = useCredits().data, [panel, setPanel] = useState<PanelId | null>(null);
  const signOut = useSignOut(() => router.replace("/login"));
  if (!me) return <Page><ActivityIndicator color="accent" /></Page>;
  if (!me.authEnabled) return <Page><View className="gap-3"><Card><Text className="text-[12.5px] text-muted">{text("account.noAccounts")}</Text></Card><ThemeChoice /></View></Page>;
  const user = me.user;
  if (!user) return <Page><ActivityIndicator color="accent" /></Page>;
  const c = credits?.enabled ? credits : null, name = user.email.split("@")[0], paid = !!c && c.plan !== "free";
  const row = (id: PanelId, icon: IconName, title: string, line: string, danger = false) => (
    <Pressable key={id} onPress={() => setPanel(id)} className="flex-row items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0 active:bg-accent/5">
      <View className={`h-10 w-10 items-center justify-center rounded-xl ${danger ? "bg-danger/[0.12]" : "bg-accent/[0.12]"}`}><Icon name={icon} size={18} color={danger ? "danger" : "accent"} /></View>
      <View className="min-w-0 flex-1">
        <Text className={`text-[14px] font-bold ${danger ? "text-danger" : "text-foreground"}`}>{title}</Text>
        <Text numberOfLines={1} className="text-[12.5px] text-muted">{line}</Text>
      </View>
      <Icon name="chevron" size={18} color="muted" />
    </Pressable>
  );
  const label = (s: string) => <Text className="px-1 text-[11px] font-bold uppercase tracking-[2.2px] text-muted">{s}</Text>;
  const panelProps = (id: PanelId, title: string) => ({ open: panel === id, onClose: () => setPanel(null), title, where: text("nav.myAccount"), closeLabel: text("common.close") });
  return (
    <Page>
      <View className="gap-4">
        <Card className="gap-4 overflow-hidden">
          <View className="absolute -right-10 -top-16 h-44 w-44"><Paint paint={{ angle: 0, stops: ["transparent"], glows: [[50, 50, 50, "rgba(216,189,123,.2)"]] }} /></View>
          <View className="flex-row items-center gap-4">
            <Avatar email={name} size={64} />
            <View className="min-w-0 flex-1">
              <Heading className="capitalize">{name}</Heading>
              <View className="flex-row items-center gap-1.5">
                <Text numberOfLines={1} className="shrink text-[13px] text-muted">{user.email}</Text>
                <Badge tone={user.emailVerified === false ? "warning" : "success"} className="h-5 px-2">{text(user.emailVerified === false ? "auth.unverifiedBadge" : "auth.verifiedBadge")}</Badge>
              </View>
              <Badge tone={paid ? "brand" : "neutral"} className="mt-1.5 h-6">{c ? text("nav.planSuffix", { plan: c.planName ?? "" }) : text("plan.free")}</Badge>
            </View>
          </View>
          <View className="gap-1.5">
            <Button icon={paid ? "coins" : "crown"} variant={paid ? "secondary" : "primary"} title={text(paid ? "account.manage" : "account.upgrade")} onPress={() => open("/pricing")} />
            {!paid && <Text className="text-[12px] text-muted">{text("account.freeLine")}</Text>}
          </View>
        </Card>
        {c && (
          <Card className="p-0">
            {([
              ["bolt", text("account.statCredits"), (c.balance ?? 0).toLocaleString("en-IN"), c.monthly ? text("account.monthly", { n: c.monthly.toLocaleString("en-IN") }) : ""],
              ["crown", text("account.statPlan"), c.planName ?? "", paid && c.planEnds ? text("account.until", { date: day(c.planEnds) }) : text("account.forever")],
              ["coins", text("account.statExtra"), (c.extra ?? 0).toLocaleString("en-IN"), text("account.neverExpire")],
            ] as const).map(([icon, title, value, note], i) => (
              <View key={icon} className={`min-w-0 gap-1 px-3 py-3.5 ${i ? "border-t border-border" : ""}`}>
                <Text numberOfLines={1} className="text-[11.5px] font-semibold text-muted">{title}</Text>
                <Text numberOfLines={1} className="text-[20px] font-semibold leading-[25px] tracking-[-0.2px] text-foreground">{value}</Text>
                {!!note && <Text numberOfLines={1} className="text-[11px] text-muted">{note}</Text>}
              </View>
            ))}
          </Card>
        )}
        <AdBanner place="account" />
        <View className="gap-2">
          {label(text("account.security"))}
          <Card className="overflow-hidden p-0">
            {row("password", "key", text("account.changeTitle"), text("account.rowPassword"))}
            {row("sessions", "shield", text("account.devices"), text("account.rowSessions"))}
            {row("payments", "coins", text("account.paymentsTitle"), text("account.rowPayments"))}
          </Card>
        </View>
        <ThemeChoice />
        <View className="gap-2">
          {label(text("account.danger"))}
          <Card className="overflow-hidden border-danger/30 p-0">{row("delete", "trash", text("account.deleteTitle"), text("account.rowDelete"), true)}</Card>
        </View>
        <View className="items-center"><Button variant="secondary" icon="signout" title={text("nav.signOut")} onPress={() => void signOut()} /></View>
      </View>
      <SidePanel {...panelProps("password", text("account.changeTitle"))}><ChangePassword email={user.email} onDone={() => setPanel(null)} /></SidePanel>
      <SidePanel {...panelProps("sessions", text("account.devices"))}><Sessions /></SidePanel>
      <SidePanel {...panelProps("payments", text("account.paymentsTitle"))}><Payments /></SidePanel>
      <SidePanel {...panelProps("delete", text("account.deleteTitle"))}><DeleteAccount email={user.email} /></SidePanel>
    </Page>
  );
}

function ChangePassword({ email, onDone }: { email: string; onDone: () => void }) {
  const text = useText(), [current, setCurrent] = useState(""), [next, setNext] = useState(""), [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null), [busy, setBusy] = useState(false);
  const show = { showLabel: text("auth.showPassword"), hideLabel: text("auth.hidePassword") };
  async function submit() {
    setMsg(null);
    if (!current) return setMsg({ ok: false, text: text("account.errCurrent") });
    if (!passwordOk(next)) return setMsg({ ok: false, text: text("account.errShort") });
    if (next !== again) return setMsg({ ok: false, text: text("account.errMismatch") });
    if (next === current) return setMsg({ ok: false, text: text("account.errSame") });
    setBusy(true);
    try { await mobileApi.changePassword(current, next); setCurrent(""); setNext(""); setAgain(""); setMsg({ ok: true, text: text("account.updated") }); setTimeout(onDone, 1500); }
    catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
    finally { setBusy(false); }
  }
  return (
    <View className="gap-3">
      <Card className="gap-3">
        <Field label={text("auth.email")}><Input value={email} editable={false} /></Field>
        <Field label={text("account.current")}><PasswordInput {...show} autoComplete="current-password" placeholder="••••••••" value={current} onChangeText={setCurrent} /></Field>
        <Field label={text("account.newPassword")} hint={text("auth.lengthHint")} error={next && !passwordOk(next) ? text("account.errShort") : next && next === current ? text("account.errSame") : ""} ok={passwordOk(next) && next !== current ? text("auth.strongEnough") : ""}>
          <PasswordInput {...show} autoComplete="new-password" placeholder={text("auth.newPasswordPlaceholder")} value={next} invalid={!!next && (!passwordOk(next) || next === current)} onChangeText={setNext} />
        </Field>
        <Field label={text("account.confirmNew")} error={again && again !== next ? text("account.errMismatch") : ""} ok={again && again === next ? text("auth.match") : ""}>
          <PasswordInput {...show} autoComplete="new-password" placeholder={text("auth.confirmPlaceholder")} value={again} invalid={!!again && again !== next} onChangeText={setAgain} />
        </Field>
      </Card>
      {msg && <Note ok={msg.ok}>{msg.text}</Note>}
      <View className="items-end"><Button icon="check" loading={busy} disabled={!current || !passwordOk(next) || next === current || again !== next} title={text(busy ? "account.saving" : "account.update")} onPress={() => void submit()} /></View>
    </View>
  );
}

function Sessions() {
  const text = useText(), { refresh } = useApi(), [done, setDone] = useState<string | null>(null), [busy, setBusy] = useState(false);
  return (
    <View className="gap-3">
      <Card className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-success/15"><Icon name="check" size={18} color="success" /></View>
        <View className="min-w-0 flex-1"><Text className="text-[14px] font-bold text-foreground">{text("account.thisDevice")}</Text><Text className="text-[12.5px] text-muted">{text("account.sessionsTitle")}</Text></View>
        <Badge tone="success">{text("account.signedIn")}</Badge>
      </Card>
      <Text className="text-[13px] text-muted">{text("account.sessionsText")}</Text>
      {done && <Note ok>{done}</Note>}
      <View className="items-end"><Button variant="secondary" icon="signout" loading={busy} title={text("account.everywhere")} onPress={async () => {
        setBusy(true);
        try { await mobileApi.logoutEverywhere(); await refresh(); setDone(text("account.everywhereDone")); } catch (e) { setDone(errorMessage(e)); } finally { setBusy(false); }
      }} /></View>
    </View>
  );
}

/** Payments & receipts: every order, the paid ones with their receipt number (the receipt was emailed). */
function Payments() {
  const text = useText(), q = useQuery({ queryKey: ["my-payments"], queryFn: mobileApi.payments, retry: false });
  if (q.isLoading) return <ActivityIndicator color="accent" />;
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} />;
  const list = q.data ?? [];
  if (!list.length) return <Text className="text-[13px] text-muted">{text("account.noPayments")}</Text>;
  return (
    <View className="gap-2">
      <Text className="text-[12.5px] text-muted">{text("account.paymentsNote")}</Text>
      {list.map((p) => (
        <View key={p.id} className="flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-surface px-4 py-3">
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-[14px] font-bold text-foreground">{p.label}</Text>
            <Text className="text-[12px] text-muted">{new Date(p.paidAt ?? p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}{p.receiptNo ? ` · ${p.receiptNo}` : ""}</Text>
          </View>
          <Text className="font-bold text-foreground">₹{p.amount.toLocaleString("en-IN")}</Text>
          <Badge tone={p.status === "paid" ? "success" : "neutral"}>{text(p.status === "paid" ? "account.paid" : "account.notPaid")}</Badge>
        </View>
      ))}
    </View>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const text = useText(), queryClient = useQueryClient(), { refresh } = useApi();
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState(""), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const match = confirm.trim().toLowerCase() === email;
  async function submit() {
    setError(null);
    if (!match) return setError(text("account.errEmail"));
    if (!password) return setError(text("auth.noPassword"));
    setBusy(true);
    try { await mobileApi.deleteAccount(password, confirm.trim()); queryClient.clear(); await refresh(); router.replace("/login"); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  return (
    <View className="gap-3">
      <View className="flex-row gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5"><Icon name="warn" size={17} color="danger" /><Text className="min-w-0 flex-1 text-[13px] text-danger">{text("account.deleteText")}</Text></View>
      <Card className="gap-3">
        <Field label={text("account.typeEmail", { email })} error={confirm && !match ? text("account.errEmail") : ""} ok={match ? "✓" : ""}>
          <Input value={confirm} onChangeText={setConfirm} autoCapitalize="none" autoComplete="off" keyboardType="email-address" />
        </Field>
        <Field label={text("account.yourPassword")}><PasswordInput showLabel={text("auth.showPassword")} hideLabel={text("auth.hidePassword")} autoComplete="current-password" value={password} onChangeText={setPassword} /></Field>
      </Card>
      {error && <ErrorBanner message={error} />}
      <View className="items-end"><Button variant="danger" icon="trash" loading={busy} disabled={!match || !password} title={text(busy ? "account.deleting" : "account.deleteAll")} onPress={() => void submit()} className="bg-danger" /></View>
    </View>
  );
}
