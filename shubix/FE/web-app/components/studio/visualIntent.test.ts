import { describe, expect, it } from "vitest";
import { parseDirectorVisualIntent } from "./visualIntent";

describe("AI Director visual intent", () => {
  it("extracts exact opening text from a natural-language edit request", () => {
    expect(parseDirectorVisualIntent('clip1 la opening la ek keyframe opening text effect add kar "WELCOME"'))
      .toEqual({ openingText: "WELCOME" });
  });

  it("recognises square framing requested for every clip", () => {
    expect(parseDirectorVisualIntent("please use square frame all clip as transition"))
      .toEqual({ squareFrameAll: true, transitionAll: true });
  });

  it("recognises a generic good-effects request for all videos in Roman Marathi", () => {
    expect(parseDirectorVisualIntent("saglya video vr chan effecr lav"))
      .toEqual({ effectsAll: true });
  });

  it("recognises a generic effects request for all clips in Devanagari Marathi", () => {
    expect(parseDirectorVisualIntent("सगळ्या व्हिडिओवर छान इफेक्ट लावा"))
      .toEqual({ effectsAll: true });
  });

  it("recognises an all-videos effects request in English", () => {
    expect(parseDirectorVisualIntent("apply nice effects to every video"))
      .toEqual({ effectsAll: true });
  });

  it("recognises a request to apply transitions to every clip in mixed Marathi-English", () => {
    expect(parseDirectorVisualIntent("all clip la transition apply kar"))
      .toEqual({ transitionAll: true });
  });

  it("recognises the same all-clips request in Devanagari Marathi", () => {
    expect(parseDirectorVisualIntent("सगळ्या क्लिपला ट्रांजिशन लावा"))
      .toEqual({ transitionAll: true });
  });

  it("recognises Hindi and an explicitly requested transition", () => {
    expect(parseDirectorVisualIntent("सभी क्लिप पर dissolve transition लगा दो"))
      .toEqual({ transitionAll: true, transitionType: "dissolve" });
  });

  it("recognises all-clips transition requests in Chinese", () => {
    expect(parseDirectorVisualIntent("所有片段都加转场"))
      .toEqual({ transitionAll: true });
  });

  it("recognises all-clips transition requests in Russian", () => {
    expect(parseDirectorVisualIntent("все клипы добавь переход"))
      .toEqual({ transitionAll: true });
  });

  it("recognises a named transition in an English all-clips request", () => {
    expect(parseDirectorVisualIntent("apply whip pan transition to every clip"))
      .toEqual({ transitionAll: true, transitionType: "whip" });
  });

  it("recognises Roman Marathi plural variants and localises all-clip effects", () => {
    expect(parseDirectorVisualIntent("sagle clips la chan effect lav"))
      .toEqual({ effectsAll: true });
    expect(parseDirectorVisualIntent("sagale videos var transition lav"))
      .toEqual({ transitionAll: true });
  });

  it("recognises Hindi all-video effects and does not widen a single-clip request", () => {
    expect(parseDirectorVisualIntent("sabhi videos par achhe effects laga do"))
      .toEqual({ effectsAll: true });
    expect(parseDirectorVisualIntent("is clip par achha effect lagao"))
      .toEqual({});
  });

  it("does not infer all-clips transitions from a single-clip request", () => {
    expect(parseDirectorVisualIntent("add a dissolve transition to clip 2"))
      .toEqual({});
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
