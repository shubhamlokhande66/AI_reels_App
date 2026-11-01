import { z } from "zod";

export const planIdSchema = z.enum(["free", "creator", "pro", "business"]);
export type PlanId = z.infer<typeof planIdSchema>;
export type PlanSummary = { id: PlanId; name: string; monthly: number; yearly: number; credits: number; highlight: boolean; features: string[] };
export type CreditBalance = { enabled: false } | { enabled: true; balance: number; monthly: number; extra: number; plan: PlanId; planName: string; history: { delta: number; reason: string; at: string }[] };

const rank: Record<PlanId, number> = { free: 0, creator: 1, pro: 2, business: 3 };
export function hasPlanAccess(current: PlanId, required: PlanId) { return rank[current] >= rank[required]; }
