"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { DEFAULTS, FEATURE_LIST } from "@shubix/core/lib/features-list";
import { PLAN_NAME } from "@shubix/core/lib/plan-locks";
import { Badge, Heading, Icon } from "@/components/atoms";
import { SidePanel } from "@/components/molecules";
import { useSite } from "@/components/molecules/Legal";
import { AdminsSettings } from "@/components/organisms/AdminsSettings";
import { BackupSettings } from "@/components/organisms/BackupSettings";
import { BusinessSettings } from "@/components/organisms/BusinessSettings";
import { FeatureSettings } from "@/components/organisms/FeatureSettings";
import { ReelsKeepSettings } from "@/components/organisms/ReelsKeepSettings";

/** Admin → Settings: the studio's system settings as a list of sections (like the CMS); a tap opens the section's form
 * on the right. Texts, plans and prices are in the CMS; the AI's settings and its report in Tools → AI settings. */
type Id = "business" | "admins" | "features" | "reels" | "backup";
type Tone = "success" | "neutral" | "brand" | "danger";

export function SettingsTab() {
  const [open, setOpen] = useState<Id | null>(null);
  const site = useSite().data;
  const features = useQuery({ queryKey: ["features"], queryFn: api.features }).data ?? DEFAULTS;
  const keep = useQuery({ queryKey: ["reels-keep"], queryFn: api.reelsKeep }).data;
  const admins = useQuery({ queryKey: ["admins"], queryFn: api.admins }).data;

  const missing = site ? [!site.supportEmail && "support email", !site.businessAddress && "address"].filter(Boolean) : [];
  const on = FEATURE_LIST.filter((f) => features[f.key]).length;
  const sections: { id: Id; icon: string; title: string; line: string; badge?: { text: string; tone: Tone }; body: React.ReactNode }[] = [
    {
      id: "business", icon: "bag", title: "Business details",
      line: (site && [site.businessName, site.supportEmail, site.supportPhone].filter(Boolean).join(" · ")) || "Name, email, phone and address",
      badge: missing.length ? { text: `${missing.length} missing`, tone: "danger" } : { text: "Complete", tone: "success" }, body: <BusinessSettings bare />,
    },
    {
      id: "admins", icon: "shield", title: "Administrators",
      line: admins ? admins.admins.map((a) => a.email).join(" · ") || "No administrator email yet" : "Who runs the studio: they have everything open",
      badge: admins && { text: `${admins.admins.length} admin${admins.admins.length === 1 ? "" : "s"}`, tone: "brand" }, body: <AdminsSettings bare />,
    },
    {
      id: "features", icon: "sparkle", title: "Features", line: FEATURE_LIST.map((f) => `${f.label}: ${features[f.key] ? "on" : "off"}`).join(" · "),
      badge: { text: `${on} of ${FEATURE_LIST.length} on`, tone: "brand" }, body: <FeatureSettings bare />,
    },
    {
      id: "reels", icon: "reels", title: "My Reels storage",
      line: keep ? (["free", "creator", "pro"] as const).map((p) => `${PLAN_NAME[p]}: ${keep.days[p] ? `${keep.days[p]} days` : "always"}`).join(" · ") : "How long a saved Reel is kept, per plan",
      body: <ReelsKeepSettings bare />,
    },
    { id: "backup", icon: "shield", title: "Backup", line: "Download the whole database as one file, and how to put it back", body: <BackupSettings bare /> },
  ];
  const cur = sections.find((s) => s.id === open);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
      <p className="m-0 mb-1 text-[12.5px] text-muted">Tap a section to change it. Texts, plans and prices are in the CMS; the AI is in Tools → AI settings.</p>
      {sections.map((s) => (
        <button key={s.id} type="button" onClick={() => setOpen(s.id)} aria-haspopup="dialog"
          className={cn("flex w-full items-center gap-3 rounded-2xl border bg-surface px-4 py-3.5 text-left shadow-[var(--shadow)] transition-colors md:px-5", open === s.id ? "border-accent" : "border-border hover:border-accent/60")}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name={s.icon} size={19} /></span>
          <span className="min-w-0 flex-1">
            <Heading size="section" as="h2">{s.title}</Heading>
            <span className="block truncate text-[12.5px] text-muted">{s.line}</span>
          </span>
          {s.badge && <Badge tone={s.badge.tone}>{s.badge.text}</Badge>}
          <Icon name="chevron" size={18} className="shrink-0 text-muted" />
        </button>
      ))}
      <SidePanel open={!!cur} onClose={() => setOpen(null)} title={cur?.title ?? ""} where="Settings">
        {cur?.body}
      </SidePanel>
    </div>
  );
}
