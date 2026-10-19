// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "@/lib/studio-templates";
import { TemplatesIn } from "@/server/studioTemplates";

/** what the administrator saves is checked before it reaches people */
describe("saved templates", () => {
  it("accepts the defaults", () => {
    expect(TemplatesIn.safeParse({ templates: DEFAULT_TEMPLATES }).success).toBe(true);
  });
  it("refuses unknown styles, bad colours, bad ids and bad days", () => {
    const t = DEFAULT_TEMPLATES[1];
    const bad = (x: object) => TemplatesIn.safeParse({ templates: [{ ...t, ...x }] }).success;
    expect(bad({ id: "Bad Id!" })).toBe(false);
    expect(bad({ showFrom: "1 Nov" })).toBe(false);
    expect(bad({ edit: { ...t.edit, look: "sepia" } })).toBe(false);
    expect(bad({ edit: { ...t.edit, texts: [{ ...t.edit.texts![0], color: "red" }] } })).toBe(false);
    expect(bad({ edit: { ...t.edit, texts: Array(9).fill(t.edit.texts![0]) } })).toBe(false);
    expect(bad({ showFrom: "", cover: "" })).toBe(true);   // empty = not set
  });
});
