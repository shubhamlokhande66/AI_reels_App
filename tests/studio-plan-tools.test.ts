import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyOverrides, DEFAULT_LOCKS, needMap } from "@/lib/plan-locks";
import { STUDIO_HTML } from "@/components/studio/markup";
import { initViews, PLAN_TOOLS } from "@/components/studio/views";

describe("plan locks: Studio tools", () => {
  it("Motion, Layers, Background and Voice need Pro by default", () => {
    const g = DEFAULT_LOCKS.groups.find((x) => x.id === "studio")!;
    expect(g.items.map((it) => [it.key, it.plan])).toEqual([["motion", "pro"], ["layers", "pro"], ["bg", "pro"], ["voice", "pro"]]);
    expect([...PLAN_TOOLS]).toEqual(["motion", "layers", "bg", "voice"]);
  });
  it("the administrator can move a Studio tool to another plan", () => {
    expect(needMap(applyOverrides({ items: { "studio:voice": "creator" } }))["studio:voice"]).toBe("creator");
  });
});

describe("the tool bar's plan tags", () => {
  let root: HTMLDivElement, stop: () => void;
  const tool = (k: string) => root.querySelector<HTMLButtonElement>(`.tool[data-tool="${k}"]`)!;
  const plan = (p: string, open = false, need = needMap(DEFAULT_LOCKS)) => root.dispatchEvent(new CustomEvent("brs-plan", { detail: { plan: p, open, need } }));
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    root = document.createElement("div"); root.className = "brs"; root.innerHTML = STUDIO_HTML; document.body.append(root);
    stop = initViews(root, () => {}).cleanup;
  });
  afterEach(() => { stop(); root.remove(); });

  it("a free plan sees PRO on the Pro tools, and nothing on the others", () => {
    plan("free");
    expect(tool("motion").dataset.locked).toBe("true");
    expect(tool("motion").querySelector(".protag")!.textContent).toBe("PRO");
    expect(tool("text").dataset.locked).toBe("false");
    expect(tool("text").querySelector(".protag")).toBeNull();
  });
  it("the tag names the plan the administrator set", () => {
    plan("free", false, { ...needMap(DEFAULT_LOCKS), "studio:voice": "creator" });
    expect(tool("voice").querySelector(".protag")!.textContent).toBe("CREATOR");
    plan("creator", false, { ...needMap(DEFAULT_LOCKS), "studio:voice": "creator" });
    expect(tool("voice").dataset.locked).toBe("false");
    expect(tool("motion").dataset.locked).toBe("true");
  });
  it("Pro and billing off open the tools", () => {
    plan("pro");
    expect(tool("bg").dataset.locked).toBe("false");
    plan("free", true);
    expect(tool("bg").dataset.locked).toBe("false");
  });
  it("the administrator has everything, and View as Free shows the free plan's tags", () => {
    plan("free");
    root.classList.add("admin");
    root.querySelector<HTMLButtonElement>("#tbasfree")!.click(); // turns View as Free on
    expect(tool("layers").dataset.locked).toBe("true");
    root.querySelector<HTMLButtonElement>("#tbasfree")!.click(); // and off
    expect(tool("layers").dataset.locked).toBe("false");
  });
});
