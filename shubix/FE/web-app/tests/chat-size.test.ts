import { describe, expect, it } from "vitest";
import { chatSize } from "@shubix/core/lib/chatSize";

describe("Ask Shubix: small or whole-Reel change", () => {
  it("a named shot is small, the whole Reel is big, unsure is big", () => {
    expect(chatSize("first clip should be the dance moment")).toBe("small");
    expect(chatSize("slow-mo on shot 4")).toBe("small");
    expect(chatSize("पहिल्या clip ला डान्स पाहिजे")).toBe("small");
    expect(chatSize("make the whole reel faster")).toBe("big");
    expect(chatSize("Make it calm and cinematic, slower cuts")).toBe("big");
    expect(chatSize("add some magic")).toBe("big");
    expect(chatSize("saglya video vr chan effecr lav")).toBe("big");
    expect(chatSize("apply nice effects to every video")).toBe("big");
    expect(chatSize("सगळ्या व्हिडिओवर छान इफेक्ट लावा")).toBe("big");
  });
});
