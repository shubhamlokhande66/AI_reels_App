import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, edgeAt, groupsOf, isLive, liveTemplates, todayIST } from "@/lib/studio-templates";

/** Templates are data the administrator manages: times follow the Reel's length, days decide what shows. */
describe("templates", () => {
  it("times follow the Reel's length", () => {
    expect(edgeAt({ p: 0.5, s: 0 }, 30, 0)).toBe(15);
    expect(edgeAt({ p: 1, s: -3 }, 15, 0)).toBe(12);
    expect(edgeAt({ p: 0, s: 99 }, 15, 0)).toBe(15);   // never past the end
    expect(edgeAt(undefined, 15, 7)).toBe(7);
  });
  it("shows a template on its days only, and never a hidden one", () => {
    const t = { ...DEFAULT_TEMPLATES[0], showFrom: "2026-11-01", showTo: "2026-11-10" };
    expect(isLive(t, "2026-10-31")).toBe(false);
    expect(isLive(t, "2026-11-01")).toBe(true);
    expect(isLive(t, "2026-11-10")).toBe(true);
    expect(isLive(t, "2026-11-11")).toBe(false);
    expect(isLive({ ...t, on: false }, "2026-11-05")).toBe(false);
    expect(todayIST(Date.parse("2026-10-19T20:00:00Z"))).toBe("2026-10-20");   // 1:30 am in India
  });
  it("the defaults: unique ids, every text inside its Reel, the groups in order", () => {
    expect(new Set(DEFAULT_TEMPLATES.map((t) => t.id)).size).toBe(DEFAULT_TEMPLATES.length);
    for (const t of DEFAULT_TEMPLATES) for (const x of t.edit.texts ?? []) if (!x.all) expect(edgeAt(x.from, t.len ?? 30, 0)).toBeLessThan(edgeAt(x.to, t.len ?? 30, t.len ?? 30));
    expect(liveTemplates(DEFAULT_TEMPLATES).length).toBe(DEFAULT_TEMPLATES.length);
    expect(groupsOf(DEFAULT_TEMPLATES)).toEqual(["Everyday", "Occasions", "Business", "Travel & food", "Festivals"]);
  });
});
