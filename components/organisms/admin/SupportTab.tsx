"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Badge, Button, Heading, Icon, Toggle } from "@/components/atoms";
import { EmptyState, ErrorBanner, Segmented } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";

const TOPIC: Record<string, string> = { account: "Account & sign-in", payment: "Payments & credits", reels: "Making Reels", rewards: "Invites & affiliates", other: "Something else" };
const when = (s: string) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Admin → Support: the Contact page's messages (reply by email; mark done), the Help chat's recent questions (what
 * people get stuck on; the ones it sent to a person are marked), and the switches. */
export function SupportTab() {
  const qc = useQueryClient(), [status, setStatus] = useState<"open" | "done" | "all">("open"), [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["admin-support", status], queryFn: () => api.adminSupport(status) });
  const d = q.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-support"] });
  const toggle = async (k: "chat" | "autoReply", on: boolean, ask: { title: string; body: string }) => {
    if (!(await confirmAction({ ...ask, ok: on ? "Turn on" : "Turn off", danger: !on }))) return;
    setErr(null);
    try { await api.setSupport({ [k]: on }); refresh(); } catch (e) { setErr(errorMessage(e)); }
  };
  const mark = async (id: string, s: "open" | "done") => {
    setErr(null);
    try { await api.setSupportStatus(id, s); refresh(); } catch (e) { setErr(errorMessage(e)); }
  };
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {err && <ErrorBanner message={err} />}
      {d && (
        <div className="grid gap-3 rounded-2xl border border-border bg-surface p-4 md:grid-cols-2">
          <Toggle label="Help chat" hint="The chat button on every page: answers from your plans, prices, rules and questions (AI settings → Help chat)." on={d.settings.chat}
            onChange={(on) => void toggle("chat", on, { title: on ? "Turn the Help chat on?" : "Turn the Help chat off?", body: on ? "The chat button shows on every page (not in the editor)." : "The chat button disappears; people can still use the Contact page." })} />
          <Toggle label="“We got your message” email" hint="Sent to the person with a ticket number when they use the Contact page." on={d.settings.autoReply}
            onChange={(on) => void toggle("autoReply", on, { title: on ? "Send the confirmation email?" : "Stop the confirmation email?", body: "Only the person's copy; your team still gets every message by email." })} />
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Heading size="section" as="h2">Messages {d ? <Badge tone={d.open ? "warning" : "neutral"}>{d.open} open</Badge> : null}</Heading>
          <Segmented label="Show" value={status} onChange={(v) => setStatus(v as typeof status)} options={[{ value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "all", label: "All" }]} />
        </div>
        {!d ? <p className="m-0 text-[13px] text-muted">Loading…</p>
          : !d.messages.length ? <EmptyState icon="mail" title={status === "open" ? "No open messages" : "No messages"} hint="Messages from the Contact page appear here, and in your support email." />
          : d.messages.map((m) => (
            <article key={m.id} className={cn("flex flex-col gap-2 rounded-2xl border bg-surface p-4", m.status === "open" ? "border-[color-mix(in_srgb,var(--warning)_40%,var(--border))]" : "border-border opacity-80")}>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <b className="text-[13.5px]">{m.name || m.email}</b>{m.name && <span className="text-muted">{m.email}</span>}
                <Badge tone="brand">{TOPIC[m.topic] ?? m.topic}</Badge>
                {m.account ? <Badge tone="neutral">@{m.account.username ?? "—"} · {m.account.plan}</Badge> : <Badge tone="neutral">not signed in</Badge>}
                <span className="ml-auto text-muted">{m.id} · {when(m.at)}</span>
              </div>
              <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-relaxed">{m.message}</p>
              {m.page && <span className="text-[11.5px] text-muted">From the page {m.page}</span>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" icon="mail" href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: [${m.id}] ${TOPIC[m.topic] ?? "Your message"}`)}&body=${encodeURIComponent(`\n\n> ${m.message.split("\n").join("\n> ")}`)}`}>Reply</Button>
                {m.status === "open"
                  ? <Button size="sm" icon="check" onClick={async () => { if (await confirmAction({ title: `Mark ${m.id} done?`, body: "It moves to Done; you can open it again.", ok: "Mark done" })) void mark(m.id, "done"); }}>Done</Button>
                  : <Button size="sm" variant="ghost" onClick={() => void mark(m.id, "open")}>Open again</Button>}
              </div>
            </article>
          ))}
      </section>

      <section className="flex flex-col gap-2">
        <Heading size="section" as="h2">Help chat: recent questions</Heading>
        <p className="m-0 text-[12.5px] text-muted">What people ask the chat. <Icon name="user" size={12} className="inline" /> marks the ones it sent to your team: add an answer to Pricing → Questions in the CMS so it can answer them next time.</p>
        {d && !d.questions.length && <p className="m-0 text-[12.5px] text-muted">No questions yet.</p>}
        <div className="flex flex-col gap-1">
          {d?.questions.map((c, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px]">
              {c.needsHuman ? <Icon name="user" size={14} className="mt-0.5 shrink-0 text-warning" /> : <Icon name="check" size={14} className="mt-0.5 shrink-0 text-success" />}
              <span className="min-w-0 flex-1">{c.q}</span>
              <span className="shrink-0 text-[11.5px] text-muted">{c.signedIn ? "member" : "visitor"} · {when(c.at)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
