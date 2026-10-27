"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Heading, Icon, Input, Select, Spinner, TextArea, Toggle } from "@/components/atoms";
import { EmptyState, ErrorBanner, Field } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { api, errorMessage, type Audience, type BroadcastInput } from "@/lib/api";
import { ago, count } from "./format";

/** Admin → Messages: write to the people of the studio. It shows in their bell (the site, and the phone app, which shows
 * the site) and, when chosen, comes by email from the studio's address. Who gets it is counted before sending. */

const WHO: Record<Audience, string> = { all: "Everyone", paying: "Paying (a paid plan now)", free: "Free plan", affiliates: "Affiliates (active)" };
const EMPTY: BroadcastInput = { title: "", body: "", link: "", button: "", audience: "all", email: false };

export function MessagesTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin", "broadcasts"], queryFn: api.broadcasts });
  const [v, setV] = useState<BroadcastInput>(EMPTY), [done, setDone] = useState<string | null>(null);
  const [n, setN] = useState<{ people: number; emails?: number; emailsOff?: number; over?: boolean } | null>(null);
  // who would get it: counted again when the group or "email" changes
  useEffect(() => {
    let live = true;
    api.sendBroadcast({ ...EMPTY, title: "xx", body: "xx", audience: v.audience, email: v.email, dryRun: true }).then((r) => live && setN(r)).catch(() => live && setN(null));
    return () => { live = false; };
  }, [v.audience, v.email]);
  const send = useMutation({
    mutationFn: () => api.sendBroadcast(v),
    onSuccess: (r) => {
      setDone(`Sent to ${count(r.people)} ${r.people === 1 ? "person" : "people"}${v.email ? ` · ${count(r.emailed ?? 0)} emails${r.emailFailed ? `, ${r.emailFailed} failed` : ""}` : ""}.`);
      setV(EMPTY);
      void qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] });
    },
  });
  const del = useMutation({ mutationFn: api.deleteBroadcast, onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] }) });
  const ready = v.title.trim().length >= 2 && v.body.trim().length >= 2;
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setDone(null);
    if (!ready) return;
    const who = n ? `${count(n.people)} ${n.people === 1 ? "person" : "people"}` : WHO[v.audience];
    if (await confirmAction({ title: `Send to ${who}?`, body: `“${v.title.trim()}” shows in their bell${v.email ? ` and is emailed to ${count(n?.emails ?? 0)} of them` : ""}. Emails cannot be taken back.`, ok: "Send" })) send.mutate();
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <div>
          <Heading size="section" as="h2">New message</Heading>
          <p className="m-0 mt-0.5 text-[12.5px] text-muted">It appears in the bell 🔔 on the website and in the app. Tick email to also send it to their inbox.</p>
        </div>
        <form onSubmit={go} className="flex flex-col gap-3.5">
          <Field label="Title"><Input value={v.title} maxLength={80} placeholder="Diwali offer: 30% off Pro" onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
          <Field label="Message" hint={`${v.body.length}/1500`}><TextArea rows={4} value={v.body} maxLength={1500} placeholder="What you want to tell them" onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Link (optional)" hint="A page of the app (/pricing) or https://…"><Input value={v.link} maxLength={300} placeholder="/pricing" onChange={(e) => setV({ ...v, link: e.target.value })} /></Field>
            <Field label="Button text (optional)"><Input value={v.button} maxLength={30} placeholder="See plans" onChange={(e) => setV({ ...v, button: e.target.value })} /></Field>
          </div>
          <Field label="Who gets it" hint={n ? `${count(n.people)} ${n.people === 1 ? "person" : "people"}` : "Counting…"}>
            <Select value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value as Audience })} className="text-[13.5px]">
              {(Object.keys(WHO) as Audience[]).map((a) => <option key={a} value={a}>{WHO[a]}</option>)}
            </Select>
          </Field>
          <Toggle label="Also send by email" hint={v.email && n ? `${count(n.emails ?? 0)} emails${n.emailsOff ? ` · ${n.emailsOff} turned announcement emails off` : ""}${n.over ? " · at most 400 a message (your mail service's daily limit)" : ""}` : "From the studio's email address, with a link to stop these emails."}
            on={v.email} onChange={(email) => setV({ ...v, email })} />
          {send.error && <ErrorBanner message={errorMessage(send.error)} />}
          {done && <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-success"><Icon name="check" size={15} />{done}</p>}
          <Button type="submit" icon="send" loading={send.isPending} disabled={!ready} className="self-end">{send.isPending && v.email ? "Sending emails…" : "Send"}</Button>
        </form>
      </Card>

      <Heading size="section" as="h2">Sent</Heading>
      {list.isLoading ? <Spinner label="Loading messages…" />
        : list.error ? <ErrorBanner message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        : !list.data?.broadcasts.length ? <EmptyState icon="bell" title="No messages yet" hint="What you send shows here." />
        : (
          <div className="flex flex-col gap-2.5">
            {list.data.broadcasts.map((b) => (
              <Card key={b.id} className="flex flex-col gap-1.5 p-3.5 md:p-4">
                <div className="flex items-start justify-between gap-2">
                  <b className="min-w-0 text-[14px]">{b.title}</b>
                  <button type="button" className="shrink-0 text-[12px] font-semibold text-muted hover:text-danger" disabled={del.isPending}
                    onClick={async () => { if (await confirmAction({ title: "Remove this message?", body: "It goes from everyone's bell. Emails already sent stay sent.", ok: "Remove", danger: true })) del.mutate(b.id); }}>Remove</button>
                </div>
                <p className="m-0 whitespace-pre-line text-[13px] text-muted">{b.body}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                  <Badge tone="neutral">{WHO[b.audience]}</Badge>
                  <span>{count(b.people)} people</span>
                  {b.email && <span>· {count(b.emailed)} emailed{b.emailFailed ? ` (${b.emailFailed} failed)` : ""}</span>}
                  <span>· {ago(b.at)}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
}
