import { route } from "@/server/core/http";
import REGISTRY from "@/server/video/registry.json";

/** Everything the manual editor can apply: transitions, per-shot effects and colour looks (all rendered for real). */
export const GET = route(async () => ({ transitions: REGISTRY.transitions, effects: REGISTRY.effects, looks: REGISTRY.looks }));
