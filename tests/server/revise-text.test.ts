// @vitest-environment node
import { describe, expect, it } from "vitest";
import { act, describe as describeAction, parseAiActions, parseRules } from "@/server/revise/actions";
import { tidyText } from "@/server/video/overlays";
import { wrapLines } from "@/server/video/render/text";
import { fontFor, needsShaping } from "@/server/core/fonts";

/** On-screen text in any language, exactly as typed (was backend/tests/test_revise.py on the Instagram branch). */
const MR = "बाप्पा गेले… पण मन अजूनही त्यांच्यातच आहे";

describe("the user's own words", () => {
  it.each([`${MR} 🥹❤️ add this text`, `add this text ${MR} 🥹❤️`, `add this text: ${MR}`, `add text "${MR}"`, `${MR} हा मजकूर टाका`, `हा टेक्स्ट टाका: ${MR}`])(
    "keeps Marathi text exactly: %s", (req) => {
      const [acts, unknown] = parseRules(req);
      expect(acts.map((a) => a.kind)).toEqual(["hook_text"]);
      expect(unknown).toEqual([]);
      expect(String(acts[0].value).replace(" 🥹❤️", "")).toBe(MR);
    });

  it("handles Hindi, English and text mixed with other changes", () => {
    expect(parseRules("ये लिखो: बप्पा चले गए… पर दिल अभी भी उन्हीं में है")[0][0].value).toBe("बप्पा चले गए… पर दिल अभी भी उन्हीं में है");
    expect(parseRules("add this text Bappa left... but my heart is still with him")[0][0].value).toBe("Bappa left... but my heart is still with him");
    const [mixed] = parseRules(`add this text ${MR} and make the music louder`);
    expect(mixed.map((a) => a.kind)).toEqual(["hook_text", "music_volume"]);
    expect(mixed[0].value).toBe(MR);
    const [end] = parseRules(`add this text at the end: ${MR}`);
    expect(end[0].kind).toBe("cta");
    expect(end[0].value).toBe(MR);
    for (const plain of ["add captions", "remove the text", "make the music louder", "add this text and make it bigger"])
      expect(parseRules(plain)[0].every((a) => a.kind !== "hook_text" && a.kind !== "cta"), plain).toBe(true);
  });

  it("lets the AI find the words but never rewrite them", () => {
    const req = `${MR} 🥹❤️`;
    const [ok] = parseAiActions({ actions: [{ action: "hook_text", value: MR }] }, 5, new Set(), req);
    expect(ok[0].value).toBe(MR);
    const [bad, dropped] = parseAiActions({ actions: [{ action: "hook_text", value: "दलृती दलृती" }] }, 5, new Set(), req);
    expect(bad).toEqual([]);
    expect(dropped[0]).toContain("changed your words");
  });

  it("leaves emoji out of the video text and says so", () => {
    expect(tidyText(`${MR} 🥹❤️`)).toBe(MR);
    expect(tidyText("Save this for your friends 🎉")).toBe("Save this for your friends"); // English letters (and spaces) untouched
    expect(describeAction(act("hook_text", { value: `${MR} 🥹❤️` }))).toContain("emoji are left out");
  });
});

describe("text layout", () => {
  it("wraps long text onto balanced lines and keeps short text on one", () => {
    expect(wrapLines("Save this")).toEqual(["Save this"]);
    const lines = wrapLines("Three mistakes every new runner makes in the first week");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join(" ")).toBe("Three mistakes every new runner makes in the first week");
  });
  it("picks a font that has the letters for Marathi and Hindi", () => {
    expect(needsShaping(MR)).toBe(true);
    expect(needsShaping("Hello")).toBe(false);
    expect(fontFor("Hello", "Arial")).toBe("Arial");
    expect(["Nirmala UI", "Noto Sans Devanagari", "Mangal"]).toContain(fontFor(MR, "Arial"));
  });
});
