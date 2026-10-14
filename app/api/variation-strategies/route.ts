import { route } from "@/server/core/http";
import { DEFAULT_SET, STRATEGIES } from "@/server/director/creative";

export const GET = route(async () => Object.values(STRATEGIES).map((s) => ({ id: s.id, label: s.label, description: s.description, style: s.style, order: s.order, default: DEFAULT_SET.includes(s.id) })));
