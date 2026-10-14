import "server-only";
import { z } from "zod";
import { env } from "@/server/core/config";
import type { EditingStyle } from "@/server/styles";
import { withOverrides } from "@/server/styles";
import PRESETS from "./presets.json";

/** Trend Mode (was backend/app/trends): structured trend presets turned into style overrides - the built-in ones, plus
 * a licensed provider's JSON feed when TREND_FEED_URL is set (read at most once an hour; nothing is scraped). */

export const TrendPreset = z.object({
  id: z.string(), trendName: z.string(), recommendedDuration: z.number().int(), cutFrequency: z.enum(["fast", "medium", "slow"]),
  transitionStyle: z.enum(["smooth", "punchy", "minimal"]), captionStyle: z.string().default("minimal"), description: z.string().default(""),
});
export type TrendPreset = z.infer<typeof TrendPreset>;

const CACHE_SECONDS = 3600;
const g = globalThis as unknown as { __trendFeed?: { at: number; rows: TrendPreset[] } };

async function feed(): Promise<TrendPreset[]> {
  const url = env("TREND_FEED_URL");
  if (!url) return [];
  const cache = (g.__trendFeed ??= { at: 0, rows: [] });
  if (Date.now() / 1000 - cache.at > CACHE_SECONDS) {
    try {
      const key = env("TREND_FEED_KEY");
      const r = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let rows: unknown = await r.json();
      if (rows && typeof rows === "object" && !Array.isArray(rows)) rows = (rows as { trends?: unknown }).trends ?? [];
      const out: TrendPreset[] = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const p = TrendPreset.safeParse(row);
        if (p.success) out.push({ ...p.data, id: `feed-${p.data.id}`.slice(0, 60) }); // a bad row never breaks the list
      }
      cache.rows = out.slice(0, 50);
    } catch (e) {
      console.warn("trend feed not reachable, using the last good one:", e);
    }
    cache.at = Date.now() / 1000;
  }
  return cache.rows;
}

export async function listTrends(): Promise<TrendPreset[]> {
  return [...(await feed()), ...(PRESETS as TrendPreset[])];
}

export async function getTrend(id: string): Promise<TrendPreset | null> {
  return (await listTrends()).find((t) => t.id === id) ?? null;
}

const PACE: Record<string, [number, number, number, number]> = { fast: [1, 2, 0.35, 2.5], medium: [2, 4, 0.8, 4.0], slow: [4, 8, 1.6, 6.0] };
const FEEL: Record<string, [Record<string, number>, number]> = {
  smooth: [{ cut: 0.2, dissolve: 0.4, fade: 0.2, blur: 0.1, zoom: 0.1 }, 0.45],
  punchy: [{ cut: 0.6, flash: 0.15, zoom: 0.15, slide: 0.1 }, 0.12],
  minimal: [{ cut: 1.0 }, 0.1],
};

/** A trend over a base style: pacing and transition feel come from the trend. */
export function applyTrend(style: EditingStyle, trend: TrendPreset): EditingStyle {
  const [bh, bl, mn, mx] = PACE[trend.cutFrequency];
  const [transitions, duration] = FEEL[trend.transitionStyle];
  return withOverrides(style, {
    cutBeatsHigh: bh, cutBeatsLow: bl, minSegment: mn, maxSegment: mx, transitions: { ...transitions }, transitionDuration: duration,
    maxTransitionRatio: trend.transitionStyle === "smooth" ? 0.9 : style.maxTransitionRatio, captionStyle: trend.captionStyle,
  });
}
