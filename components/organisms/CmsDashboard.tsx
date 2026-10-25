"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useContent, useMe, useTexts } from "@/hooks/useApi";
import { type TextDef, type TextGroup } from "@/lib/texts";
import { LISTS, listDef, type ListItem } from "@/lib/collections";
import { ListEditor } from "@/components/organisms/cms/ListEditor";
import { ALL_TEXT_DEFAULTS as DEFAULTS, ALL_TEXT_GROUPS as GROUPS, STUDIO_AREA } from "@/lib/texts-all";
import { Avatar, Badge, Button, Card, Eyebrow, Heading, Icon, IconButton, Input, Logo, TextArea } from "@/components/atoms";
import { ErrorBanner, SearchBox } from "@/components/molecules";
import { ThemeToggle } from "@/components/molecules/ThemeToggle";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { useRouter } from "next/navigation";
import { AdsSettings } from "@/components/organisms/AdsSettings";
import { PlanLockSettings } from "@/components/organisms/PlanLockSettings";
import { PricingSettings } from "@/components/organisms/PricingSettings";

/** The CMS (/cms, its own dashboard, opened from the admin's sidebar): like a CMS back office (Umbraco).
 * Left: every page of the app (and Plans & pricing, plan locks, ads). A page opens on the right with all its sections
 * (Home → Hero, Create Your Reel, …); a tap on a section opens its form on the right: its cards and their fields
 * (Music Reel card → Title, Line).
 * Unsaved texts are kept while moving between pages and published together with "Save and publish" (in the header). */

const AREAS = ["Pages", "On every page", "Plans & payments", STUDIO_AREA] as const;
// the CMS's own panels (not texts), in the "Plans & payments" area
const PANELS = [
  { id: "pricing", name: "Plans & pricing", icon: "bolt", body: () => <PricingSettings /> },
  { id: "locks", name: "Plan locks", icon: "lock", body: () => <PlanLockSettings /> },
  { id: "ads", name: "Ads", icon: "trend", body: () => <AdsSettings /> },
] as const;
// each page's own icon in the list (a page without one: the text icon)
const ICONS: Record<string, string> = {
  home: "home", pricing: "coins", voices: "mic", auth: "key", account: "user", reels: "reels", brands: "star", templates: "grid", contact: "mail", legal: "shield", notfound: "warn",
  nav: "menu", plan: "crown", common: "chat", checkout: "bag",
  "studio-create": "sparkle", "studio-tools": "layers", "studio-chat": "chat", "studio-story": "book", "studio-names": "palette", "studio-messages": "bell",
};
type Open = { kind: "page"; id: string } | { kind: "panel"; id: (typeof PANELS)[number]["id"] };

const sectionsOf = (g: TextGroup) => [...new Set(g.items.map((t) => t.section ?? "Texts"))];
/** a section's fields by card, in the order they are written */
const cardsOf = (items: TextDef[]) => {
  const cards = new Map<string, TextDef[]>();
  for (const t of items) { const c = t.card ?? "Texts"; if (!cards.has(c)) cards.set(c, []); cards.get(c)!.push(t); }
  return [...cards];
};

export function CmsDashboard() {
  const qc = useQueryClient();
  const q = useTexts();
  const me = useMe();
  const saved = useMemo(() => q.data ?? {}, [q.data]);
  const [open, setOpen] = useState<Open>({ kind: "page", id: GROUPS[0].id });
  const [sheet, setSheet] = useState<{ page: string; section: string } | null>(null); // the section open in the form on the right
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);
  const [draft, setDraft] = useState<Record<string, string | null>>({}); // unsaved: text, or null = back to the default
  const [find, setFind] = useState("");
  const [done, setDone] = useState(false);
  const [menu, setMenu] = useState(false); // phones: the page list
  useEffect(() => {
    if (!menu) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [menu]);

  const value = (k: string) => (k in draft ? (draft[k] ?? DEFAULTS[k]) : (saved[k] ?? DEFAULTS[k]));
  const changed = (k: string) => value(k) !== DEFAULTS[k];
  const count = (items: TextDef[]) => items.filter((t) => changed(t.key)).length;
  // the lists (Home's cards, tips, questions…): unsaved ones, else the saved ones, else their first items
  const content = useContent();
  const [lists, setLists] = useState<Record<string, ListItem[] | null>>({}); // unsaved: items, or null = the first items again
  const listOf = (id: string) => (id in lists ? (lists[id] ?? listDef(id).items) : (content.data?.[id] ?? listDef(id).items));
  const listChanged = (id: string) => (id in lists ? lists[id] !== null : !!content.data?.[id]);
  const dirty = Object.keys(draft).length + Object.keys(lists).length;
  const discard = () => { setDraft({}); setLists({}); };
  const edit = (k: string, v: string | null) => { setDone(false); setDraft((d) => ({ ...d, [k]: v })); };
  const save = useMutation({
    mutationFn: async () => {
      // the lists first: a list that is not right (a card without a link) stops before any text is published
      if (Object.keys(lists).length) qc.setQueryData(["content"], await api.setContent(lists));
      if (Object.keys(draft).length) {
        const t = await api.setTexts(draft);
        qc.setQueryData(["texts"], t);
        try { window.localStorage.setItem("shubix-texts", JSON.stringify(t)); } catch { /* private mode */ }
      }
    },
    onSuccess: () => { discard(); setDone(true); },
  });
  const go = (o: Open) => { setOpen(o); setFind(""); setMenu(false); setSheet(null); window.scrollTo({ top: 0 }); };
  const needle = find.trim().toLowerCase();
  const router = useRouter();
  const leave = (href: string, icon: string, name: string) => (
    <button type="button" onClick={async () => {
      if (dirty && !(await confirmAction({ title: `Leave with ${dirty} unsaved change${dirty === 1 ? "" : "s"}?`, body: "They are not published. Save and publish first to keep them.", ok: "Leave without saving", cancel: "Stay", danger: true }))) return;
      router.push(href);
    }} className="flex min-h-[40px] items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13.5px] text-muted hover:bg-accent/6 hover:text-foreground">
      <Icon name={icon} size={16} stroke={1.8} />{name}
    </button>
  );

  // ---- the page list (left)
  const pageItem = (key: string, on: boolean, icon: string, name: string, n: number, onClick: () => void) => (
    <button key={key} type="button" onClick={onClick} aria-current={on ? "page" : undefined}
      className={cn("flex min-h-[40px] items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13.5px] transition-colors", on ? "bg-accent/12 font-bold text-foreground" : "text-muted hover:bg-accent/6 hover:text-foreground")}>
      <Icon name={icon} size={16} stroke={1.8} color={on ? "var(--accent)" : undefined} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {n > 0 && <span title={`${n} changed`} className="rounded-full bg-accent/15 px-1.5 text-[11px] font-bold text-accent">{n}</span>}
    </button>
  );
  const pages = (
    <nav aria-label="Pages" className="flex flex-col gap-0.5">
      {AREAS.map((area) => (
        <div key={area} className="flex flex-col gap-0.5">
          <Eyebrow className="px-2.5 pb-1 pt-4">{area}</Eyebrow>
          {area === "Plans & payments" && PANELS.map((p) => pageItem(p.id, !needle && open.kind === "panel" && open.id === p.id, p.icon, p.name, 0, () => go({ kind: "panel", id: p.id })))}
          {GROUPS.filter((g) => g.area === area).map((g) => pageItem(g.id, !needle && open.kind === "page" && open.id === g.id, ICONS[g.id] ?? "text", g.name, count(g.items), () => go({ kind: "page", id: g.id })))}
        </div>
      ))}
    </nav>
  );

  // ---- a field, a card, a section
  const field = (t: TextDef, where?: string) => {
    const v = value(t.key), unsaved = t.key in draft;
    return (
      <div key={t.key} className="flex flex-col gap-1.5">
        <label htmlFor={`cms-${t.key}`} className="flex items-center gap-1.5 text-[12.5px] font-bold">
          {t.label}
          {changed(t.key) && <span title={unsaved ? "Not saved yet" : "Changed from the default"} className={cn("h-2 w-2 shrink-0 rounded-full", unsaved ? "bg-warning" : "bg-accent")} />}
          {where && <span className="ml-auto truncate text-[11px] font-normal text-muted">{where}</span>}
        </label>
        {t.long || v.length > 70 ? (
          <TextArea id={`cms-${t.key}`} value={v} onChange={(e) => edit(t.key, e.target.value)} rows={t.value.length > 400 ? 14 : 3} />
        ) : (
          <Input id={`cms-${t.key}`} value={v} onChange={(e) => edit(t.key, e.target.value)} />
        )}
        {changed(t.key) && (
          <button type="button" onClick={() => edit(t.key, null)} className="self-start text-[11.5px] font-semibold text-muted hover:text-accent" title={`Default: ${DEFAULTS[t.key] || "(empty)"}`}>
            Reset to default
          </button>
        )}
      </div>
    );
  };
  const itemsOf = (g: TextGroup, name: string) => g.items.filter((t) => (t.section ?? "Texts") === name);
  const listsOf = (g: TextGroup, name: string) => LISTS.filter((l) => l.page === g.id && l.section === name);
  // a section in the page's list: a tap opens its form on the right
  const sectionRow = (g: TextGroup, name: string) => {
    const items = itemsOf(g, name), n = count(items), cards = cardsOf(items), on = sheet?.page === g.id && sheet.section === name;
    return (
      <button key={name} type="button" onClick={() => setSheet({ page: g.id, section: name })} aria-haspopup="dialog"
        className={cn("flex w-full items-center gap-3 rounded-2xl border bg-surface px-4 py-3.5 text-left shadow-[var(--shadow)] transition-colors md:px-5", on ? "border-accent" : "border-border hover:border-accent/60")}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent"><Icon name="grid" size={17} /></span>
        <span className="min-w-0 flex-1">
          <Heading size="section" as="h2">{name}</Heading>
          <span className="block truncate text-[12px] text-muted">{[...listsOf(g, name).map((l) => `${listOf(l.id).length} ${l.itemName}s (add more)`), ...cards.map(([c]) => c)].join(" · ")}</span>
        </span>
        {n > 0 && <Badge tone="brand">{n} changed</Badge>}
        {listsOf(g, name).some((l) => l.id in lists) && <Badge tone="brand">list changed</Badge>}
        <span className="hidden text-[12px] text-muted sm:inline">{items.length} field{items.length === 1 ? "" : "s"}</span>
        <Icon name="chevron" size={18} className="shrink-0 text-muted" />
      </button>
    );
  };

  // ---- what is open (right)
  let body: React.ReactNode;
  if (needle) {
    const hits = GROUPS.flatMap((g) => g.items.map((t) => ({ t, where: [g.name, t.section, t.card].filter(Boolean).join(" › ") })))
      .filter(({ t, where }) => `${t.label} ${value(t.key)} ${where}`.toLowerCase().includes(needle));
    body = (
      <>
        <div><Heading size="page" className="text-[26px] md:text-[28px]">Search: “{find.trim()}”</Heading><p className="m-0 text-[12.5px] text-muted">{hits.length} text{hits.length === 1 ? "" : "s"} found</p></div>
        <Card className="flex flex-col gap-4">{hits.slice(0, 80).map(({ t, where }) => field(t, where))}{!hits.length && <p className="m-0 py-6 text-center text-sm text-muted">Nothing matches.</p>}</Card>
      </>
    );
  } else if (open.kind === "panel") {
    const p = PANELS.find((x) => x.id === open.id)!;
    body = (
      <>
        <div><p className="m-0 text-[12px] text-muted">Plans & payments</p><Heading size="page" className="text-[26px] md:text-[28px]">{p.name}</Heading></div>
        {p.body()}
      </>
    );
  } else {
    const g = GROUPS.find((x) => x.id === open.id)!, secs = sectionsOf(g);
    body = (
      <>
        <div>
          <p className="m-0 text-[12px] text-muted">{g.area} › {g.name}</p>
          <Heading size="page" className="text-[26px] md:text-[28px]">{g.name}</Heading>
          <p className="m-0 text-[12.5px] text-muted">{secs.length} section{secs.length === 1 ? "" : "s"}: tap one to edit it</p>
        </div>
        <div className="flex flex-col gap-2">{secs.map((x) => sectionRow(g, x))}</div>
      </>
    );
  }

  const email = me.data?.user?.email;
  return (
    <div className="flex min-h-screen flex-col">
      {/* the header */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-[var(--bar)] px-4 backdrop-blur md:px-6">
        <button type="button" className="grid h-10 w-10 place-items-center rounded-full md:hidden" aria-label={menu ? "Close pages" : "Pages"} aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name={menu ? "close" : "menu"} size={22} /></button>
        <Logo height={40} />
        <Badge tone="brand" className="h-7 px-3 text-[12px]">CMS</Badge>
        <SearchBox value={find} onChange={setFind} label="Search every text…" className="ml-2 hidden h-10 max-w-md md:flex" />
        <div className="ml-auto flex items-center gap-2">
          {/* Save and publish (the texts and lists): on the pages and the search, and wherever there is something to publish;
              Plans & pricing and Plan locks have their own Save */}
          {(open.kind === "page" || needle || dirty > 0) && (
            <>
            {save.error ? <span className="hidden max-w-[220px] truncate text-[12.5px] text-danger lg:inline" title={errorMessage(save.error)}>{errorMessage(save.error)}</span>
              : <span className={cn("hidden text-[12.5px] lg:inline", dirty ? "font-bold text-warning" : "text-muted")}>{dirty ? `${dirty} unsaved change${dirty === 1 ? "" : "s"}` : done ? "✓ Published" : "All saved"}</span>}
            {dirty > 0 && <Button size="sm" variant="secondary" onClick={discard} disabled={save.isPending}>Discard</Button>}
            <Button size="sm" icon="check" onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>Save and publish{dirty ? ` (${dirty})` : ""}</Button>
            </>
          )}
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
          {email && <Avatar email={email} size={32} />}
        </div>
      </header>

      {/* the section's form, on the right */}
      {sheet && (() => {
        const g = GROUPS.find((x) => x.id === sheet.page)!, items = itemsOf(g, sheet.section), n = count(items);
        return (
          <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={sheet.section}>
            <div className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]" onClick={() => setSheet(null)} />
            <div className="absolute inset-y-0 right-0 flex w-full max-w-[680px] animate-sheet flex-col border-l border-border bg-background shadow-2xl">
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[12px] text-muted">{g.name} › {sheet.section}</p>
                  <Heading>{sheet.section}</Heading>
                </div>
                {n > 0 && <Badge tone="brand">{n} changed</Badge>}
                <IconButton icon="close" label="Close" onClick={() => setSheet(null)} />
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-surface-2/40 p-4 md:p-5">
                {cardsOf(items).map(([card, fields]) => (
                  <Card key={card} as="section" aria-label={card} className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Heading size="section" as="h3" className="text-[14px]">{card}</Heading>
                      {count(fields) > 0 && <span className="ml-auto text-[11px] font-bold text-accent">{count(fields)} changed</span>}
                    </div>
                    {fields.map((t) => field(t))}
                  </Card>
                ))}
                {listsOf(g, sheet.section).map((l) => (
                  <ListEditor key={l.id} def={l} items={listOf(l.id)} changed={listChanged(l.id)}
                    onChange={(x) => { setDone(false); setLists((d) => ({ ...d, [l.id]: x })); }}
                    onReset={() => { setDone(false); setLists((d) => ({ ...d, [l.id]: null })); }} />
                ))}
              </div>
              <div className="flex items-center gap-2 border-t border-border bg-[var(--bar)] px-5 py-3">
                <span className={cn("mr-auto text-[12.5px]", dirty ? "font-bold text-warning" : "text-muted")}>{dirty ? `${dirty} unsaved change${dirty === 1 ? "" : "s"}` : done ? "✓ Published" : "All saved"}</span>
                <Button variant="secondary" onClick={() => setSheet(null)}>Close</Button>
                <Button icon="check" onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>Save and publish</Button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="flex flex-1">
        {/* the page list: a sidebar on computers, a drawer on phones */}
        {/* phones: a dim backdrop behind the open page list (a tap closes it) */}
        {menu && <div className="fixed inset-x-0 bottom-0 top-16 z-20 bg-[var(--overlay)] backdrop-blur-[2px] md:hidden" onClick={() => setMenu(false)} aria-hidden />}
        <aside className={cn("shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-background px-3 pb-[max(24px,env(safe-area-inset-bottom))]",
          "md:sticky md:top-16 md:flex md:h-[calc(100vh-64px)] md:w-64 md:bg-[var(--sidebar)]",
          menu ? "fixed bottom-0 left-0 top-16 z-30 flex w-[86%] max-w-[300px] shadow-2xl" : "hidden")}>
          <SearchBox value={find} onChange={setFind} label="Search every text…" className="mt-3 h-10 md:hidden" />
          {pages}
          <div className="flex-1" />
          {/* leaving the CMS: to the admin dashboard, or back to the site (asks first when something is not saved) */}
          <div className="mt-4 flex flex-col gap-0.5 border-t border-border pt-3">
            {leave("/admin", "admin", "Go to Admin")}
            <a href="/" target="_blank" rel="noreferrer" className="flex min-h-[40px] items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] text-muted hover:bg-accent/6 hover:text-foreground">
              <Icon name="eye" size={16} stroke={1.8} />View site<span className="ml-auto text-[11px]" aria-hidden>↗</span>
            </a>
            {leave("/", "signout", "Exit CMS")}
          </div>
          <ThemeToggle className="mt-1" />
        </aside>

        {/* the open page */}
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4 pb-10 md:p-6 md:pb-10">
          {q.error && <ErrorBanner message={errorMessage(q.error)} />}
          {body}
        </main>
      </div>

    </div>
  );
}
