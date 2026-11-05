// @vitest-environment node
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** One-time codes by email (server/accounts.ts): the sign-up code verifies the email, the reset code sets a new password;
 * 6 digits, 10 minutes, 5 wrong tries, once, a new one at most every minute; a sign-up code never resets a password. */

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/core/mail", async (orig) => ({
  ...(await orig<typeof import("../../src/server/core/mail")>()),
  sendMail: async (to: string, subject: string, text: string) => { sent.push({ to, subject, text }); return true; },
}));

let mongo: MongoMemoryServer;
let A: typeof import("../../src/server/accounts");
let withUser: typeof import("../../src/server/core/auth").withUser;
let mainDb: typeof import("../../src/server/core/db").mainDb;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "otp_test";
  process.env.AUTH_ENABLED = "true";
  A = await import("../../src/server/accounts");
  ({ withUser } = await import("../../src/server/core/auth"));
  ({ mainDb } = await import("../../src/server/core/db"));
  await (await import("../../src/server/core/indexes")).ensureIndexes();
}, 120_000);
afterAll(async () => {
  await (await (await import("../../src/server/core/db")).client()).close();
  await mongo?.stop();
});
beforeEach(async () => { sent.length = 0; await (await mainDb()).collection("users").deleteMany({}); });

const codeMails = () => sent.filter((m) => /\d{6}/.test(m.subject)); // (a new account also gets the welcome email)
const lastCode = () => /\d{6}/.exec(codeMails().at(-1)!.subject)![0];
const signUp = async (email: string) => { await A.register(email, "password123"); return String((await (await mainDb()).collection("users").findOne({ email }))!._id); };
const other = (c: string) => String((Number(c) + 1) % 1_000_000).padStart(6, "0");

describe("one-time codes", () => {
  it("verify the email with the sign-up code, once", async () => {
    const id = await signUp("otp@x.com");
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(codeMails().at(-1)?.text).toContain(code);
    await expect(withUser(id, () => A.verifyCode(other(code)))).rejects.toThrow(/not right. 4 tries left/);
    expect(await withUser(id, () => A.verifyCode(code))).toMatchObject({ ok: true, email: "otp@x.com" });
    await vi.waitFor(() => expect(sent.find((m) => m.to === "otp@x.com" && m.subject.startsWith("Welcome"))?.text).toMatch(/\/pricing[\s\S]*Stop these emails/));
    expect((await withUser(id, () => A.me())).user?.emailVerified).toBe(true);
    expect(await withUser(id, () => A.verifyCode(code))).toMatchObject({ ok: true }); // already verified: fine
  });

  it("lock after 5 wrong tries; a new code works; resend waits a minute", async () => {
    const id = await signUp("lock@x.com");
    const code = lastCode();
    for (let i = 0; i < 4; i++) await expect(withUser(id, () => A.verifyCode(other(code)))).rejects.toThrow(/not right/);
    await expect(withUser(id, () => A.verifyCode(other(code)))).rejects.toThrow(/Too many wrong tries/);
    await expect(withUser(id, () => A.verifyCode(code))).rejects.toThrow(/Too many wrong tries/); // even the right one now
    await expect(withUser(id, () => A.resendVerify())).rejects.toThrow(/wait \d+ seconds/);
    await (await mainDb()).collection("users").updateOne({ email: "lock@x.com" }, { $set: { "verifyOtp.sentAt": new Date(Date.now() - 61_000) } });
    await withUser(id, () => A.resendVerify());
    expect(await withUser(id, () => A.verifyCode(lastCode()))).toMatchObject({ ok: true });
  });

  it("an old code expires", async () => {
    const id = await signUp("old@x.com");
    await (await mainDb()).collection("users").updateOne({ email: "old@x.com" }, { $set: { "verifyOtp.expires": new Date(Date.now() - 1000) } });
    await expect(withUser(id, () => A.verifyCode(lastCode()))).rejects.toThrow(/expired/);
  });

  it("reset the password with the reset code (never with a sign-up code); the same answer for unknown emails", async () => {
    await signUp("reset@x.com");
    const signupCode = lastCode();
    expect(await A.forgot("nobody@x.com")).toMatchObject({ ok: true });
    expect(sent.some((m) => m.to === "nobody@x.com")).toBe(false);
    await expect(A.resetWithCode("nobody@x.com", "123456", "newpassword1")).rejects.toThrow(/expired/);

    await A.forgot("reset@x.com");
    const code = lastCode();
    expect(sent.at(-1)?.subject).toMatch(/password reset code/);
    await expect(A.resetWithCode("reset@x.com", signupCode === code ? other(code) : signupCode, "newpassword1")).rejects.toThrow(/not right/);
    await expect(A.resetWithCode("reset@x.com", code, "short")).rejects.toThrow(/at least 8/);
    const r = await A.resetWithCode("reset@x.com", code, "newpassword1");
    expect(r.status).toBe(200);
    await expect(A.resetWithCode("reset@x.com", code, "another-one1")).rejects.toThrow(/expired/); // once
    expect((await A.login("reset@x.com", "newpassword1")).status).toBe(200);
    expect((await (await mainDb()).collection("users").findOne({ email: "reset@x.com" }))?.emailVerified).toBe(true); // the code proved the email

    await A.forgot("reset@x.com");
    const n = sent.length;
    await A.forgot("reset@x.com"); // within the minute: no second email
    expect(sent.length).toBe(n);
  });
});

describe("no code, no account", () => {
  it("the code screen is told how long is left before a new code", async () => {
    const id = await signUp("wait@x.com");
    const left = (await withUser(id, () => A.me())).user as { codeWait?: number };
    expect(left.codeWait).toBeGreaterThan(50);
    expect(left.codeWait).toBeLessThanOrEqual(60);
    await expect(withUser(id, () => A.resendVerify())).rejects.toMatchObject({ code: "VERIFY_TOO_SOON", details: { wait: expect.any(Number) } });
    await withUser(id, () => A.verifyCode(lastCode()));
    expect((await withUser(id, () => A.me())).user).not.toHaveProperty("codeWait");
  });

  const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
  const asUser = async (path: string, cookie: string) => (await import("../../src/server/core/auth")).resolveUser(new Request(`http://x${path}`, { headers: { cookie } }));

  it("a new account opens nothing until its code is entered", async () => {
    const cookie = cookieOf(await A.register("new@x.com", "password123"));
    const u = await (await mainDb()).collection("users").findOne({ email: "new@x.com" }), id = String(u!._id);
    await expect(asUser("/api/credits", cookie)).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED", status: 403 });
    await expect(asUser("/api/studio/direct", cookie)).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(await asUser("/api/plans", cookie)).toBeNull();                 // public: as nobody
    expect(await asUser("/api/auth/verify", cookie)).toBe(id);             // what the code screen needs
    await withUser(id, () => A.verifyCode(other(lastCode()))).catch(() => {});
    await expect(asUser("/api/credits", cookie)).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" }); // a wrong code opens nothing
    await withUser(id, () => A.verifyCode(lastCode()));
    expect(await asUser("/api/credits", cookie)).toBe(id);
  });

  it("signing in does not skip the code, and sends a new one", async () => {
    await A.register("back@x.com", "password123");
    await (await mainDb()).collection("users").updateOne({ email: "back@x.com" }, { $unset: { "verifyOtp.sentAt": "" } }); // a minute has passed
    const before = codeMails().length, r = await A.login("back@x.com", "password123");
    expect(codeMails().length).toBe(before + 1);
    expect((await r.clone().json()).user.emailVerified).toBe(false);
    await expect(asUser("/api/credits", cookieOf(r))).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  it("an account from before the codes keeps working; a welcome email only after the code", async () => {
    const id = (await (await mainDb()).collection("users").insertOne({ email: "old@x.com", password: "x", sessionVersion: 0 })).insertedId;
    const { makeToken, COOKIE } = await import("../../src/server/core/auth");
    expect(await asUser("/api/credits", `${COOKIE}=${makeToken(String(id))}`)).toBe(String(id));
    const uid = await signUp("w@x.com");
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.filter((m) => m.to === "w@x.com" && !/\d{6}/.test(m.subject)).length).toBe(0);
    await withUser(uid, () => A.verifyCode(lastCode()));
  });
});
