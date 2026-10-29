"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { emailOk } from "@/lib/validate";
import { Button, Card, Heading, Icon, IconTile, Input, Select, TextArea } from "@/components/atoms";
import { ErrorBanner, Field, Hero } from "@/components/molecules";
import { siteOr, useSite } from "@/components/molecules/Legal";
import { useList, useMe, useT } from "@/hooks/useApi";
import type { Tone } from "@/lib/ui";

/** One way to reach us: its icon, its name and the address (a card that is a link). */
function Way({ href, icon, tone, title, line }: { href: string; icon: string; tone: Tone; title: string; line: string }) {
  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
      <Card variant="interactive" className="flex items-center gap-3">
        <IconTile icon={icon} tone={tone} size={38} />
        <span className="flex min-w-0 flex-col">
          <b>{title}</b>
          <span className="truncate text-[12.5px] text-muted">{line}</span>
        </span>
      </Card>
    </a>
  );
}

const TOPICS = ["account", "payment", "reels", "rewards", "other"] as const;

/** Contact us (design: "Contact"): email, WhatsApp, and a message sent straight to the team (a ticket number back, and a
 * copy by email). The Help chat sends people here with their question filled in (?topic=…&message=…). */
export default function ContactPage() {
  const s = siteOr(useSite().data);
  const me = useMe();
  const t = useT();
  const ways = useList("contact.ways").filter((w) => w.title && w.link);
  const [from, setFrom] = useState(""), [name, setName] = useState(""), [topic, setTopic] = useState<string>("other");
  const [text, setText] = useState(""), [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [ticket, setTicket] = useState<string | null>(null);
  const email = from || me.data?.user?.email || "";
  const realEmail = !!s.email;
  const wa = s.phone.replace(/[^\d]/g, "");
  // from the Help chat: the topic and the question already written
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tp = q.get("topic"), msg = q.get("message");
    if (tp || msg) void Promise.resolve().then(() => { if (tp && (TOPICS as readonly string[]).includes(tp)) setTopic(tp); if (msg) setText(msg.slice(0, 4000)); });
  }, []);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!emailOk(email)) return setError(t("auth.badEmail"));
    setBusy(true);
    try {
      let page = "";
      try { page = document.referrer ? new URL(document.referrer).pathname : ""; } catch { /* no referrer */ }
      const r = await api.contact({ email: email.trim(), name: name.trim(), topic, message: text.trim(), page, website: trap });
      setTicket(r.ticket);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="relative mx-auto w-full max-w-5xl pb-5">
      <div aria-hidden className="pointer-events-none absolute -top-10 left-1/2 -z-10 h-56 w-[min(90vw,48rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--accent)_12%,transparent),transparent_68%)] blur-2xl" />
      <div className="mb-5 sm:mb-7"><Hero title={t("contact.title")} subtitle={t("contact.sub")} /></div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(250px,.78fr)_minmax(0,1.22fr)] lg:gap-6">
        <aside className="flex flex-col gap-3">
          <div className="mb-1 flex items-center gap-2 px-1 text-[9px] font-extrabold uppercase tracking-[.18em] text-muted"><span className="h-px w-5 bg-accent/70" />{t("contact.title")}</div>
          {realEmail && <Way href={`mailto:${s.email}`} icon="mail" tone="talk" title={t("contact.email")} line={s.email} />}
          {s.phone && <Way href={`https://wa.me/${wa}`} icon="chat" tone="story" title={t("contact.whatsapp")} line={s.phone} />}
          {/* more ways: Admin → CMS → Contact us → Ways to reach us */}
          {ways.map((w) => <Way key={w.id} href={w.link} icon={w.icon || "send"} tone={(w.tone || "brand") as Tone} title={w.title} line={w.text} />)}
          {(s.address || s.name) && <p className="m-0 mt-1 rounded-xl border border-border/70 bg-surface/50 px-3.5 py-3 text-[11px] leading-relaxed text-muted">{s.name}{s.address ? ` · ${s.address}` : ""}</p>}
        </aside>
        <Card as="section" aria-label={t("contact.formTitle")} className="relative !rounded-[22px] !border-[color-mix(in_srgb,var(--accent)_15%,var(--line))] !p-4 sm:!p-6">
        {ticket ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-success/15 text-success"><Icon name="check" size={24} /></span>
            <Heading size="section">{t("contact.sentTitle")}</Heading>
            <p className="m-0 text-[13px] text-muted">{t("contact.sentText", { ticket, email: email.trim() })}</p>
            <Button size="sm" variant="secondary" onClick={() => { setTicket(null); setText(""); }}>{t("contact.another")}</Button>
          </div>
        ) : (
          <form className="relative flex flex-col gap-3" onSubmit={send}>
            <Heading size="section">{t("contact.formTitle")}</Heading>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("contact.yourEmail")}>
                <Input type="email" required autoComplete="email" placeholder={t("auth.emailPlaceholder")} value={email} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label={t("contact.yourName")}>
                <Input autoComplete="name" placeholder={t("contact.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </Field>
            </div>
            <Field label={t("contact.topic")}>
              <Select value={topic} onChange={(e) => setTopic(e.target.value)}>
                {TOPICS.map((k) => <option key={k} value={k}>{t(`contact.topic.${k}`)}</option>)}
              </Select>
            </Field>
            {topic === "payment" && <p className="m-0 rounded-xl bg-surface-2 px-3 py-2 text-[12px] text-muted">{t("contact.paymentHint")}</p>}
            <Field label={t("contact.message")}>
              <TextArea required rows={5} maxLength={4000} placeholder={t("contact.messagePlaceholder")} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            {/* a field people never see: form-filling bots fill it in */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden value={trap} onChange={(e) => setTrap(e.target.value)} className="pointer-events-none absolute left-0 top-0 h-0 w-0 opacity-0" />
            {error && <ErrorBanner message={error} />}
            <Button type="submit" icon="send" loading={busy} disabled={text.trim().length < 10 || !emailOk(email)}>{t("contact.send")}</Button>
            <span className="text-[11px] text-muted">{t("contact.replyNote")}</span>
          </form>
        )}
        </Card>
      </div>
    </div>
  );
}
