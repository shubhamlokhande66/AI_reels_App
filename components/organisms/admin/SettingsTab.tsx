"use client";

import { useState } from "react";
import { AiDirectorReport } from "@/components/organisms/AiDirectorReport";
import { AiSettingsPanel } from "@/components/organisms/AiSettingsPanel";
import { FeatureSettings } from "@/components/organisms/FeatureSettings";
import { PlanLockSettings } from "@/components/organisms/PlanLockSettings";
import { PricingSettings } from "@/components/organisms/PricingSettings";
import { ReelsKeepSettings } from "@/components/organisms/ReelsKeepSettings";
import { SiteSetupNotice } from "@/components/organisms/SiteSetupNotice";

/** Every setting of the studio, in one place: what is on, prices and plans, the AI. */
const SECTIONS = [
  { id: "features", label: "Features", body: () => <FeatureSettings /> },
  { id: "pricing", label: "Plans & pricing", body: () => <PricingSettings /> },
  { id: "locks", label: "Plan locks", body: () => <PlanLockSettings /> },
  { id: "reels", label: "My Reels", body: () => <ReelsKeepSettings /> },
  { id: "ai", label: "AI", body: () => <AiSettingsPanel /> },
  { id: "report", label: "AI report", body: () => <AiDirectorReport /> },
] as const;

export function SettingsTab() {
  const [open, setOpen] = useState<(typeof SECTIONS)[number]["id"]>("features");
  const section = SECTIONS.find((s) => s.id === open)!;
  return (
    <div className="flex flex-col gap-3">
      <SiteSetupNotice />
      <div className="tabs2 overflow-x-auto" role="tablist" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={open === s.id} className={open === s.id ? "on" : ""} onClick={() => setOpen(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={section.label} className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {section.body()}
      </div>
    </div>
  );
}
