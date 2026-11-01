"use client";

import { PlanGate } from "@/components/organisms/PlanGate";
import { VoiceProfiles } from "@/components/organisms/VoiceProfiles";

/** Voice profiles: a Pro page (lib/plan-locks.ts page:voices; Admin → CMS → Plan locks can change it). */
export default function VoicesPage() {
  return (
    <PlanGate item="page:voices">
      <VoiceProfiles />
    </PlanGate>
  );
}
