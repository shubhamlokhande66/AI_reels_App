"use client";

import { useState } from "react";
import { Button, Card, Heading, IconTile, Input, TextArea } from "@/components/atoms";
import { Field, Hero } from "@/components/molecules";
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

/** Contact us (design: "Contact"): email, WhatsApp, and a message that opens in your email app. */
export default function ContactPage() {
  const s = siteOr(useSite().data);
  const me = useMe();
  const t = useT();
  const ways = useList("contact.ways").filter((w) => w.title && w.link);
  const [from, setFrom] = useState("");
  const [text, setText] = useState("");
  const email = from || me.data?.user?.email || "";
  const realEmail = !!s.email;
  const wa = s.phone.replace(/[^\d]/g, "");
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const body = `${text.trim()}\n\n— ${email}`;
    window.location.href = `mailto:${s.email}?subject=${encodeURIComponent(t("contact.subject"))}&body=${encodeURIComponent(body)}`;
  };
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <Hero title={t("contact.title")} subtitle={t("contact.sub")} />
      {realEmail && <Way href={`mailto:${s.email}`} icon="mail" tone="talk" title={t("contact.email")} line={s.email} />}
      {s.phone && <Way href={`https://wa.me/${wa}`} icon="chat" tone="story" title={t("contact.whatsapp")} line={s.phone} />}
      {/* more ways: Admin → CMS → Contact us → Ways to reach us */}
      {ways.map((w) => <Way key={w.id} href={w.link} icon={w.icon || "send"} tone={(w.tone || "brand") as Tone} title={w.title} line={w.text} />)}
      {realEmail && (
        <Card as="section" aria-label={t("contact.formTitle")}>
          <form className="flex flex-col gap-3" onSubmit={send}>
            <Heading size="section">{t("contact.formTitle")}</Heading>
            <Field label={t("contact.yourEmail")}>
              <Input type="email" required placeholder={t("auth.emailPlaceholder")} value={email} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t("contact.message")}>
              <TextArea required placeholder={t("contact.messagePlaceholder")} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Button type="submit" disabled={!text.trim()}>{t("contact.send")}</Button>
            <span className="text-[11px] text-muted">{t("contact.opensMail")}</span>
          </form>
        </Card>
      )}
      {!realEmail && !s.phone && !ways.length && (
        <Card className="flex flex-col gap-1">
          <b>{t("contact.soonTitle")}</b>
          <span className="text-[12.5px] text-muted">{t("contact.soonText")}</span>
        </Card>
      )}
      <p className="m-0 text-center text-[11px] text-muted">
        {s.name}
        {s.address ? ` · ${s.address}` : ""}
      </p>
    </div>
  );
}
