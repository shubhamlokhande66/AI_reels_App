// @vitest-environment node
import { describe, expect, it } from "vitest";
import { presign } from "../../src/server/storage/r2";

describe("Signature V4 presigned URLs", () => {
  it("matches AWS's documented example (GET examplebucket/test.txt, 24 h)", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = presign({
      method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", region: "us-east-1", service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", expires: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toContain("X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request");
    expect(url.endsWith("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404")).toBe(true);
  });

  it("signs a part upload's query (partNumber, uploadId) and encodes the key", () => {
    const url = new URL(presign({
      method: "PUT", host: "acc.r2.cloudflarestorage.com", path: "/bucket/projects/p1/input/a b.mp4", query: { partNumber: "3", uploadId: "x/y+z" },
      region: "auto", service: "s3", accessKeyId: "k", secretAccessKey: "s", expires: 3600,
    }));
    expect(url.pathname).toBe("/bucket/projects/p1/input/a%20b.mp4");
    expect(url.searchParams.get("partNumber")).toBe("3");
    expect(url.searchParams.get("uploadId")).toBe("x/y+z");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});
