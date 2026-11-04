/** The administrator's wording in Fast Studio (Admin → CMS → Studio …). The studio is plain DOM code that
 * writes its own English, so a changed text is swapped where it shows: in text and in the title, placeholder and
 * aria-label people read, also when the studio writes it later (a toast, a panel). Only the texts the administrator
 * changed are touched; with none changed this does nothing. A text the studio puts together from parts ("3 clips")
 * is not swapped. */

const ATTRS = ["title", "placeholder", "aria-label"] as const;

import { setStudioWords } from "./i18n";

export function startTextSwap(root: HTMLElement, swaps: Map<string, string>): () => void {
  setStudioWords(swaps); // the studio's own text helpers show these words straight away (i18n.ts tx)
  if (!swaps.size) return () => {};
  const done = new WeakMap<Node, string>(); // what we last wrote into a node: not swapped again (no loops)

  const text = (n: Text) => {
    const v = n.nodeValue ?? "";
    if (done.get(n) === v) return;
    const to = swaps.get(v.trim());
    if (to === undefined) return;
    const next = v.replace(v.trim(), to); // keep the spaces around it
    done.set(n, next);
    n.nodeValue = next;
  };
  const attrs = (el: Element) => {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v === null) continue;
      const to = swaps.get(v.trim());
      if (to !== undefined && to !== v) el.setAttribute(a, to);
    }
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return text(node as Text);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
    attrs(el);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) text(n as Text);
      else attrs(n as Element);
    }
  };

  walk(root);
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") text(m.target as Text);
      else if (m.type === "attributes") attrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  });
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  return () => mo.disconnect();
}
