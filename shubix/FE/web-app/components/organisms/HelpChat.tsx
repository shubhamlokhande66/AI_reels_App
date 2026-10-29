"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { useT } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { Button, Icon } from "@/components/atoms";
import { RichText } from "@/components/molecules/RichText";

type Msg = { role: "user" | "assistant"; content: string; human?: boolean; suggestions?: string[] };
const KEY = "shubix-help";
const load = (): Msg[] => { try { return JSON.parse(sessionStorage.getItem(KEY) || "[]") as Msg[]; } catch { return []; } };
const keep = (m: Msg[]) => { try { sessionStorage.setItem(KEY, JSON.stringify(m.slice(-30))); } catch { /* private mode */ } };

/** The Help chat (Admin → Support turns it on or off): a button at the bottom right of every page (not in the editor or
 * the admin), a chat that answers questions about Shubix, and the way to the team when a person is needed. Every word:
 * Admin → CMS → Every page → Help chat. */
export function HelpChat({ raised = true, authPlacement = false }: { raised?: boolean; authPlacement?: boolean }) {
  const t = useT(), path = usePathname() ?? "/";
  const on = useQuery({ queryKey: ["help-on"], queryFn: api.helpOn, staleTime: 600_000, retry: false }).data?.on;
  const [open, setOpen] = useState(false), [msgs, setMsgs] = useState<Msg[]>([]), [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { void Promise.resolve().then(() => setMsgs(load())); }, []);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy, open]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 60); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!on || path.startsWith("/create") || path.startsWith("/admin")) return null;

  const ask = async (q: string) => {
    const question = q.trim().slice(0, 1200);
    if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: question }];
    setMsgs(next); keep(next); setText(""); setError(null); setBusy(true);
    try {
      const r = await api.help(next.slice(-10).map(({ role, content }) => ({ role, content })), path);
      const done: Msg[] = [...next, { role: "assistant", content: r.answer, human: r.needsHuman, suggestions: r.suggestions }];
      setMsgs(done); keep(done);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const lastQuestion = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const contactHref = `/contact?topic=other&message=${encodeURIComponent(lastQuestion)}`;
  const starters = [t("help.q1"), t("help.q2"), t("help.q3"), t("help.q4")].filter(Boolean);
  const last = msgs[msgs.length - 1];

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label={t("help.open")}
          className={cn(authPlacement ? "absolute right-4 top-[calc(72px+env(safe-area-inset-top))] z-30 lg:fixed lg:bottom-6 lg:right-6 lg:top-auto" : cn("fixed right-4 z-30", raised ? "bottom-[calc(84px+env(safe-area-inset-bottom))]" : "bottom-[calc(16px+env(safe-area-inset-bottom))]", "md:bottom-6 md:right-6"), "flex h-12 items-center gap-2 rounded-full text-[var(--on-accent)] [background:var(--gold-gradient)] px-4 text-[13.5px] font-bold shadow-[0_10px_30px_-12px_var(--brand-glow)] transition-transform hover:-translate-y-0.5")}>
          <Icon name="chat" size={20} />
          <span className="hidden sm:inline">{t("help.button")}</span>
        </button>
      )}
      {open && (
        <section role="dialog" aria-label={t("help.title")}
          className={cn("fixed inset-x-3 z-40", raised ? "bottom-[calc(80px+env(safe-area-inset-bottom))]" : "bottom-[calc(12px+env(safe-area-inset-bottom))]", " flex max-h-[min(72vh,620px)] animate-sheet flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-[0_24px_70px_rgba(20,10,40,.35)] md:inset-x-auto md:bottom-6 md:right-6 md:w-[390px]")}>
          <header className="flex items-center gap-3 border-b border-white/10 bg-[linear-gradient(135deg,#29271f,#191917_62%,#393326)] px-4 py-3.5 text-white">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15"><Icon name="sparkle" size={18} /></span>
            <div className="min-w-0 flex-1">
              <b className="block text-[14.5px] leading-tight">{t("help.title")}</b>
              <span className="text-[11.5px] text-white/70">{t("help.sub")}</span>
            </div>
            {msgs.length > 0 && <button type="button" onClick={() => { setMsgs([]); keep([]); setError(null); }} className="rounded-full px-2 py-1 text-[11.5px] text-white/75 hover:bg-white/10 hover:text-white">{t("help.clear")}</button>}
            <button type="button" onClick={() => setOpen(false)} aria-label={t("help.close")} className="grid size-8 place-items-center rounded-full hover:bg-white/10"><Icon name="close" size={18} /></button>
          </header>

          <div ref={list} className="flex min-h-[220px] flex-1 flex-col gap-2.5 overflow-y-auto bg-surface-2/40 px-3.5 py-4">
            <Bubble role="assistant"><RichText text={t("help.welcome")} /></Bubble>
            {!msgs.length && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {starters.map((q) => <Chip key={q} onClick={() => void ask(q)}>{q}</Chip>)}
              </div>
            )}
            {msgs.map((m, i) => (
              <Bubble key={i} role={m.role}>
                {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
                {m.role === "assistant" && m.human && (
                  <Button size="sm" variant="secondary" icon="mail" href={contactHref} className="mt-2" onClick={() => setOpen(false)}>{t("help.contact")}</Button>
                )}
              </Bubble>
            ))}
            {busy && <Bubble role="assistant"><span className="inline-flex gap-1 py-1" aria-label={t("help.thinking")}>{[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d * 120}ms` }} />)}</span></Bubble>}
            {!busy && last?.role === "assistant" && !!last.suggestions?.length && (
              <div className="flex flex-wrap gap-1.5">{last.suggestions.map((q) => <Chip key={q} onClick={() => void ask(q)}>{q}</Chip>)}</div>
            )}
            {error && <p className="m-0 rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void ask(text); }} className="flex items-end gap-2 border-t border-border bg-background p-2.5">
            <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={1200} placeholder={t("help.placeholder")}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(text); } }}
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-accent" />
            <button type="submit" disabled={!text.trim() || busy} aria-label={t("help.send")}
              className="grid size-[42px] shrink-0 place-items-center rounded-full text-[var(--on-accent)] [background:var(--gold-gradient)] shadow-[0_8px_20px_-12px_var(--brand-glow)] transition-transform hover:scale-[1.03] disabled:opacity-40">
              <Icon name="send" size={18} />
            </button>
          </form>
          <p className="m-0 bg-background px-4 pb-2.5 text-center text-[10.5px] text-muted">{t("help.footer")}</p>
        </section>
      )}
    </>
  );
}

const Bubble = ({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) => (
  <div className={cn("max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed [&_p]:m-0 [&_p+p]:mt-1.5",
    role === "user" ? "self-end rounded-br-md text-[var(--on-accent)] [background:var(--gold-gradient)]" : "self-start rounded-bl-md border border-border bg-surface shadow-[var(--shadow)]")}>
    {children}
  </div>
);
const Chip = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-surface px-3 py-1.5 text-left text-[12.5px] text-foreground transition-colors hover:bg-accent/10">{children}</button>
);
