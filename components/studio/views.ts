/** Fast Studio's three views of the same Reel, on the markup of components/studio/markup.ts (no engine logic here):
 * - Simple: cards that open one panel each, a "Save video" bar.
 * - Editor: a tool dock that shows one panel at a time.
 * - Pro: every panel open beside the preview, the timeline underneath.
 * Also: the song and clips steps fold into one line once the Reel is made, the top bar's Export, and the cards' values. */

export type StudioView = "simple" | "editor" | "pro";
export const VIEW_KEY = "studio-view";

export function savedView(): StudioView {
  try {
    const q = new URLSearchParams(location.search).get("view");   // a link can open a view: /studio?view=pro
    if (q === "simple" || q === "editor" || q === "pro") return q;
    const v = localStorage.getItem(VIEW_KEY);
    return v === "editor" || v === "pro" ? v : "simple";
  } catch {
    return "simple";
  }
}

export function initViews(root: HTMLElement, onView: (v: StudioView) => void) {
  const ac = new AbortController(), sig = { signal: ac.signal };
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const kf = $<HTMLDetailsElement>("kfbox");
  let view: StudioView = savedView();
  let tool = "";

  const made = () => !$("s3").classList.contains("locked");
  const apply = () => {
    root.classList.remove("v-simple", "v-editor", "v-pro");
    root.classList.add("v-" + view);
    root.dataset.tool = tool;
    root.classList.toggle("made", made());
    root.querySelectorAll<HTMLButtonElement>("#views button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    root.querySelectorAll<HTMLButtonElement>(".tool").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
    root.querySelectorAll<HTMLButtonElement>(".card").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.tool === tool)));
    // the keyframe panel is open when Motion is shown (dragging the picture then moves the shot), and always in Pro
    const kfWant = view === "pro" || tool === "motion";
    if (kf.open !== kfWant) kf.open = kfWant;
  };
  const setView = (v: StudioView) => {
    view = v;
    if (v === "editor" && (!tool || tool === "music")) tool = "shots";
    if (v === "simple" && (tool === "shots" || tool === "motion")) tool = "";
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
    apply();
    onView(v);
  };
  const openStep = (id: string, open: boolean) => {
    const s = $(id), h = s.querySelector<HTMLButtonElement>(".sh")!;
    s.classList.toggle("folded", !open);
    h.setAttribute("aria-expanded", String(open));
  };

  // view switch, dock, cards
  $("views").addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]"); if (b) setView(b.dataset.view as StudioView); }, sig);
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const go = t.closest<HTMLElement>("[data-goview]"); if (go) { setView(go.dataset.goview as StudioView); return; }
    const os = t.closest<HTMLElement>("[data-open-step]"); if (os) { const id = os.dataset.openStep!; openStep(id, true); $(id).scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const b = t.closest<HTMLButtonElement>(".tool,.card");
    if (b) {
      const k = b.dataset.tool!;
      tool = b.classList.contains("card") && tool === k ? "" : k;   // a card closes again on a second tap
      if (k === "music" && view === "editor") { openStep("s1", true); }
      apply();
      if (b.classList.contains("card") && tool) root.querySelector<HTMLElement>(`.panel[data-panel="${k}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    const sh = t.closest<HTMLButtonElement>(".step > .sh");
    if (sh) { const s = sh.parentElement!; openStep(s.id, s.classList.contains("folded")); }
  }, sig);

  // the top bar's Export is the same button as the save bar's
  const exp = $<HTMLButtonElement>("export"), top = $<HTMLButtonElement>("topexport");
  top.addEventListener("click", () => exp.click(), sig);
  const mirror = () => { if (top.disabled !== exp.disabled) top.disabled = exp.disabled; };   // only on a change: a write is a mutation too

  // the cards show what is chosen now
  const pressed = (id: string) => root.querySelector(`#${id} [aria-pressed="true"]`)?.textContent?.trim() || "";
  const cv = (k: string, v: string) => { const el = root.querySelector(`[data-cv="${k}"]`); if (el && el.textContent !== v) el.textContent = v; };
  const values = () => {
    const ref = !$("refbox").hidden && pressed("mode") === "Copy a Reel";
    cv("style", ref ? "Copied Reel" : pressed("mode"));
    const hook = $<HTMLInputElement>("hook").value.trim(), n = root.querySelectorAll("#ovlist .ov").length;
    cv("text", hook ? "“" + (hook.length > 16 ? hook.slice(0, 15) + "…" : hook) + "”" + (n ? " + " + n : "") : n ? n + " text" + (n > 1 ? "s" : "") : "Add a hook");
    cv("look", pressed("look"));
    const d = $("mdur").textContent?.trim();
    cv("music", d && d !== "—" ? d.replace(/\.\d+/g, "") : "Choose a song");
    cv("captions", $<HTMLInputElement>("caps").checked ? "On" : $("capwrap").hidden ? "—" : "Off");
    cv("voice", !$("vodel").hidden ? "Voiceover on" : "Record a voiceover");
    cv("bg", pressed("bgmode"));
  };

  // fold the song and clips once the Reel is made (tap the line to open them again)
  let wasMade = made();
  const onChange = () => {
    mirror(); values();
    const m = made();
    if (m !== wasMade) {
      wasMade = m;
      openStep("s1", !m); openStep("s2", !m);
      if (m && view === "editor" && !tool) tool = "shots";
      apply();
    }
  };
  const mo = new MutationObserver(onChange);
  mo.observe(root, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "disabled", "class", "hidden"], childList: true, characterData: true });
  root.addEventListener("input", values, sig);

  if (view === "editor") tool = "shots";
  apply(); onChange(); onView(view);
  return { setView, cleanup: () => { ac.abort(); mo.disconnect(); } };
}
