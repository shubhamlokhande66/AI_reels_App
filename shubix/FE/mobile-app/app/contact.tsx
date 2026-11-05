import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useApi, useText } from "@mobile/hooks";
import { Button, Card, Chip, ErrorBanner, Field, Heading, Icon, IconTile, Input, Page, TextArea, tell } from "@mobile/ui-mobile";
import type { IconName, Tone } from "@mobile/ui-core";
import { emailOk } from "@mobile/validations";
import { errorMessage } from "@mobile/api-client";
import { mobileApi } from "../lib/api";
import { useList } from "../lib/data";

const TOPICS = ["account", "reels", "rewards", "other"] as const;

/** One way to reach us: its icon, its name and the address (a card that opens it). */
function Way({ href, icon, tone, title, line }: { href: string; icon: IconName; tone: Tone; title: string; line: string }) {
  return (
    <Pressable onPress={() => void Linking.openURL(href)} accessibilityRole="link" className="active:opacity-80">
      <Card className="flex-row items-center gap-3">
        <IconTile icon={icon} tone={tone} size={38} />
        <View className="min-w-0 flex-1"><Text className="text-[14px] font-bold text-foreground">{title}</Text><Text numberOfLines={1} className="text-[12.5px] text-muted">{line}</Text></View>
      </Card>
    </Pressable>
  );
}

/** Contact us (the website's app/contact/page.tsx): email, WhatsApp and the administrator's ways, then a message sent
 * straight to the team (a ticket number back, and a copy by email). The Help chat fills in ?topic= and ?message=. */
export default function ContactScreen() {
  const text = useText(), { me } = useApi(), q = useLocalSearchParams<{ topic?: string; message?: string }>();
  const site = useQuery({ queryKey: ["site"], queryFn: mobileApi.site, staleTime: 3_600_000 }).data;
  const ways = useList("contact.ways").filter((w) => w.title && w.link);
  const [from, setFrom] = useState<string | null>(null), [name, setName] = useState("");
  const [topic, setTopic] = useState<string>(TOPICS.includes(q.topic as never) ? q.topic! : "other"), [message, setMessage] = useState((q.message ?? "").slice(0, 4000));
  const [touched, setTouched] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [ticket, setTicket] = useState<string | null>(null);
  const email = from ?? me?.user?.email ?? "", wa = (site?.supportPhone ?? "").replace(/[^\d]/g, "");
  const emailErr = touched && email && !emailOk(email) ? text("auth.badEmail") : "";
  const valid = emailOk(email) && message.trim().length >= 10;
  async function send() {
    setError(null); setBusy(true);
    try { const r = await mobileApi.contact({ email: email.trim(), name: name.trim(), topic, message: message.trim() }); setTicket(r.ticket); tell(text("contact.sentTitle"), "success"); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Page>
      <View className="gap-4">
        <View><Heading size="page">{text("contact.title")}</Heading><Text className="mt-1 text-[13.5px] leading-5 text-muted">{text("contact.sub")}</Text></View>
        <View className="gap-3">
          {site?.supportEmail ? <Way href={`mailto:${site.supportEmail}`} icon="mail" tone="talk" title={text("contact.email")} line={site.supportEmail} /> : null}
          {wa ? <Way href={`https://wa.me/${wa}`} icon="chat" tone="story" title={text("contact.whatsapp")} line={site!.supportPhone} /> : null}
          {ways.map((w) => <Way key={w.id} href={w.link!} icon={(w.icon || "send") as IconName} tone={(w.tone || "brand") as Tone} title={w.title!} line={w.text ?? ""} />)}
          {site?.businessName || site?.businessAddress ? <Text className="rounded-xl border border-border/70 bg-surface/50 px-3.5 py-3 text-[11px] leading-4 text-muted">{site.businessName}{site.businessAddress ? ` · ${site.businessAddress}` : ""}</Text> : null}
        </View>
        <Card className="rounded-[22px] border-accent/15 p-4">
          {ticket ? (
            <View className="items-center gap-2 py-3">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-success/15"><Icon name="check" size={24} color="success" /></View>
              <Heading size="section">{text("contact.sentTitle")}</Heading>
              <Text className="text-center text-[13px] text-muted">{text("contact.sentText", { ticket, email: email.trim() })}</Text>
              <Button size="sm" variant="secondary" title={text("contact.another")} onPress={() => { setTicket(null); setMessage(""); }} />
            </View>
          ) : (
            <View className="gap-3">
              <Heading size="section">{text("contact.formTitle")}</Heading>
              <Field label={text("contact.yourEmail")} error={emailErr}>
                <Input value={email} onChangeText={setFrom} onBlur={() => setTouched(true)} invalid={!!emailErr} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder={text("auth.emailPlaceholder")} />
              </Field>
              <Field label={text("contact.yourName")}><Input value={name} onChangeText={setName} autoComplete="name" maxLength={80} placeholder={text("contact.namePlaceholder")} /></Field>
              <Field label={text("contact.topic")}>
                <View className="flex-row flex-wrap gap-2">{TOPICS.map((k) => <Chip key={k} label={text(`contact.topic.${k}`)} on={topic === k} onPress={() => setTopic(k)} />)}</View>
              </Field>
              <Field label={text("contact.message")}><TextArea value={message} onChangeText={setMessage} maxLength={4000} placeholder={text("contact.messagePlaceholder")} /></Field>
              {error ? <ErrorBanner message={error} /> : null}
              <Button full icon="send" loading={busy} disabled={!valid} title={text("contact.send")} onPress={() => void send()} />
              <Text className="text-[11px] text-muted">{text("contact.replyNote")}</Text>
            </View>
          )}
        </Card>
      </View>
    </Page>
  );
}
