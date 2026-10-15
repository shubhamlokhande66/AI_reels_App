// @vitest-environment node
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The job queue in MongoDB (server/jobs/manager.ts) against a real, throw-away database: jobs wait with their whole
 * input, are taken one at a time in order, a job whose instance died is queued again once and then failed, and a
 * waiting job can be cancelled. The pipeline itself is a stand-in that finishes when the test says so. */

const gate = vi.hoisted(() => ({ calls: [] as string[], release: [] as (() => void)[] }));
vi.mock("@/server/jobs/pipeline", async (orig) => {
  const real = await orig<typeof import("@/server/jobs/pipeline")>();
  return {
    ...real,
    runPipeline: vi.fn(async (inp: { projectId: string }) => {
      gate.calls.push(inp.projectId);
      await new Promise<void>((r) => gate.release.push(r));
      return real.newResult();
    }),
  };
});

let mongo: MongoMemoryServer;
type Manager = typeof import("@/server/jobs/manager");
let m: Manager;
let mainDb: typeof import("@/server/core/db").mainDb;
let ObjectId: typeof import("@/server/core/db").ObjectId;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "queue_test";
  process.env.MAX_CONCURRENT_JOBS = "1";
  m = await import("@/server/jobs/manager");
  ({ mainDb, ObjectId } = await import("@/server/core/db"));
}, 120_000);

afterAll(async () => {
  const { client } = await import("@/server/core/db");
  await (await client()).close();
  await mongo?.stop();
});

beforeEach(async () => {
  delete process.env.APP_ROLE;
  for (const r of gate.release.splice(0)) r(); // let anything still running finish
  await new Promise((r) => setTimeout(r, 50));
  gate.calls.length = 0;
  const d = await mainDb();
  await Promise.all(["jobs", "projects", "media"].map((c) => d.collection(c).deleteMany({})));
});

/** A project with one clip, ready to analyse. */
async function project(name: string) {
  const d = await mainDb(), _id = new ObjectId(), media = new ObjectId();
  await d.collection("media").insertOne({ _id: media, projectId: _id, kind: "video", originalName: "a.mp4", storedKey: `projects/${_id}/input/a.mp4`, width: 1080, height: 1920 });
  await d.collection("projects").insertOne({ _id, name, status: "draft", settings: {}, videoOrder: [media], createdAt: new Date() });
  return String(_id);
}
const job = async (id: unknown) => (await (await mainDb()).collection("jobs").findOne({ _id: new ObjectId(String(id)) }))!;
const until = async (ok: () => Promise<boolean> | boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 25)); }
};

describe("the job queue", () => {
  it("stores the job with its whole input, so any instance can run it; a web-only instance runs nothing", async () => {
    process.env.APP_ROLE = "web";
    const j = await m.submit(await project("A"), "analyze");
    await until(async () => !!(await job(j._id)).queue);
    const doc = await job(j._id);
    expect(doc.status).toBe("queued");
    expect(doc.claimedBy).toBeNull();
    expect(JSON.parse(doc.queue.input)).toMatchObject({ jobType: "analyze", videos: [{ name: "a.mp4" }] });
    expect(await m.queuePosition(doc)).toBe(1);
    expect(gate.calls).toEqual([]);
  });

  it("runs jobs one at a time, oldest first, and finishes them", async () => {
    const a = await project("A"), b = await project("B");
    const ja = await m.submit(a, "analyze"), jb = await m.submit(b, "analyze");
    await until(() => gate.calls.length === 1);
    expect(gate.calls).toEqual([a]); // B waits for the free slot
    expect((await job(jb._id)).status).toBe("queued");
    expect(await m.queuePosition(await job(jb._id))).toBe(1);

    gate.release.shift()!();
    await until(async () => (await job(ja._id)).status === "completed");
    await until(() => gate.calls.length === 2);
    expect(gate.calls).toEqual([a, b]);
    gate.release.shift()!();
    await until(async () => (await job(jb._id)).status === "completed");
  });

  it("queues a job again when its instance stopped beating, and fails it cleanly the second time", async () => {
    process.env.APP_ROLE = "web"; // submit without running here
    const j = await m.submit(await project("A"), "analyze");
    await until(async () => !!(await job(j._id)).queue);
    const jobs = (await mainDb()).collection("jobs"), old = new Date(Date.now() - 10 * 60_000);
    const dies = () => jobs.updateOne({ _id: j._id }, { $set: { status: "processing", claimedBy: "dead-instance", heartbeatAt: old } });

    const sweepDue = () => { (globalThis as { __jobs?: { lastSweep: number } }).__jobs!.lastSweep = 0; }; // sweeps run every 30 s
    await dies();
    sweepDue();
    await m.recoverStaleJobs();
    let doc = await job(j._id);
    expect([doc.status, doc.claimedBy, doc.queue.attempts]).toEqual(["queued", null, 1]);

    await dies();
    sweepDue();
    await m.recoverStaleJobs();
    doc = await job(j._id);
    expect(doc.status).toBe("failed");
    expect(doc.error.code).toBe("JOB_INTERRUPTED");
  });

  it("never takes a job whose files live in other storage (a computer running against the live database)", async () => {
    process.env.APP_ROLE = "web";
    const j = await m.submit(await project("A"), "analyze");
    await until(async () => !!(await job(j._id)).queue);
    await (await mainDb()).collection("jobs").updateOne({ _id: j._id }, { $set: { "queue.storage": "r2:the-live-bucket" } });
    delete process.env.APP_ROLE;
    await m.pump();
    await new Promise((r) => setTimeout(r, 100));
    expect(gate.calls).toEqual([]);
    expect((await job(j._id)).claimedBy).toBeNull();
    expect((await job(j._id)).queue.storage).not.toBe(m.storageId());
  });

  it("cancels a waiting job at once and gives the project back its status", async () => {
    process.env.APP_ROLE = "web";
    const p = await project("A");
    const j = await m.submit(p, "analyze");
    await until(async () => !!(await job(j._id)).queue);
    expect(await m.requestCancel(String(j._id))).toBe(true);
    expect((await job(j._id)).status).toBe("cancelled");
    expect((await (await mainDb()).collection("projects").findOne({ _id: new ObjectId(p) }))!.status).toBe("draft");
    expect(await m.requestCancel(String(j._id))).toBe(false); // nothing left to cancel
  });
});
