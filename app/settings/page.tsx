"use client";

import { PageHeader } from "@/components/molecules";
import { AiSettingsPanel } from "@/components/organisms/AiSettingsPanel";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <PageHeader title="AI settings" subtitle="Which AI does each job. Changes apply to new Reels." />
      <AiSettingsPanel />
    </div>
  );
}
