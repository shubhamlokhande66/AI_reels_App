import { route } from "@/server/core/http";
import { learnedStyle } from "@/server/studio/styles";

/** The learned style of one kind of Reel (?category=wedding&scope=mine|all). */
export const GET = route(async (req) => { const u = new URL(req.url); return learnedStyle(u.searchParams.get("category") ?? "", u.searchParams.get("scope") === "mine" ? "mine" : "all"); });
