import { describe, expect, it } from "vitest";
import { createTasks } from "../components/studio/tasks";

/** The Create flow's one popup: before Generate the work goes on behind the page, then the popup shows what is left. */
describe("the work popup", () => {
  const popup = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-tasks]")!;
  const setQuiet = (host: HTMLElement, on: boolean) => { host.dataset.fquiet = on ? "1" : ""; host.dispatchEvent(new Event("studio-quiet")); };

  it("stays hidden while the flow is quiet, and shows the same work after", () => {
    const host = document.createElement("div"), tasks = createTasks(host);
    setQuiet(host, true);
    tasks.start("clips", "clips", "Reading your clips", "Clip 1 of 3");
    expect(tasks.has("clips")).toBe(true);
    expect(popup(host).hidden).toBe(true);
    setQuiet(host, false);
    expect(popup(host).hidden).toBe(false);
    expect(popup(host).textContent).toContain("Reading your clips");
  });
  it("shows at once when the flow is not quiet", () => {
    const host = document.createElement("div"), tasks = createTasks(host);
    tasks.start("clips", "clips", "Reading your clips", "");
    expect(popup(host).hidden).toBe(false);
  });
  it("says to keep the app open while the AI works, one short line at a time", () => {
    const host = document.createElement("div"), tasks = createTasks(host);
    tasks.start("ai", "ai", "Shubix at work", "");
    const why = host.querySelector<HTMLElement>("[data-why]")!;
    expect(why.hidden).toBe(false);
    expect(why.textContent).toContain("Keep this tab open");
  });
});
