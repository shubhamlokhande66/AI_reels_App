import type { TemplateInput } from "@/types/api";

/**
 * Hands an AI-drafted template from Chat ("Save as Reel template") to the Templates page's existing
 * "review the AI draft, then save" editor, without the two pages knowing about each other's internals.
 * sessionStorage (not app state) because it has to survive a full page navigation.
 */
const KEY = "chat-template-draft";

export function stashTemplateDraft(template: TemplateInput): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(template));
  } catch {
    /* private browsing / storage disabled: the draft just won't hand off, nothing to recover from here */
  }
}

/** Reads and clears the pending draft, if any — read once, so a page refresh doesn't bring it back. */
export function takeTemplateDraft(): TemplateInput | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as TemplateInput;
  } catch {
    return null;
  }
}
