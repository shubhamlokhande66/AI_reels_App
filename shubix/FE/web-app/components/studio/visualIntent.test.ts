import { describe, expect, it } from "vitest";
import { parseDirectorVisualIntent } from "./visualIntent";

describe("AI Director visual intent", () => {
  it("extracts exact opening text from a natural-language edit request", () => {
    expect(parseDirectorVisualIntent('clip1 la opening la ek keyframe opening text effect add kar "WELCOME"'))
      .toEqual({ openingText: "WELCOME" });
  });

  it("recognises square framing requested for every clip", () => {
    expect(parseDirectorVisualIntent("please use square frame all clip as transition"))
      .toEqual({ squareFrameAll: true });
  });

  it("does not invent text or a frame when neither was requested", () => {
    expect(parseDirectorVisualIntent("make the first clip slower and add a punch keyframe"))
      .toEqual({});
  });

  it("keeps the requested text content intact", () => {
    expect(parseDirectorVisualIntent('add opening text "राम आये हैं"'))
      .toEqual({ openingText: "राम आये हैं" });
  });
});
