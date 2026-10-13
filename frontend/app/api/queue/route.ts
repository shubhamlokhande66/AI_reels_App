import type { ObjectId } from "mongodb";
import { db } from "@/server/core/db";
import { route } from "@/server/core/http";
import { jobOut } from "@/server/projects/service";

/** Every queued / running / recent job across projects, with its project name (the render queue). */
export const GET = route(async () => {
  const d = await db();
  const jobs = await d.collection("jobs").find({}).sort({ createdAt: -1 }).limit(30).toArray();
  const names = new Map<string, string>();
  for (const p of await d.collection("projects").find({ _id: { $in: jobs.map((j) => j.projectId as ObjectId) } }, { projection: { name: 1 } }).toArray()) names.set(String(p._id), p.name);
  const active = jobs.filter((j) => j.status === "queued" || j.status === "processing").sort((a, b) => +a.createdAt - +b.createdAt);
  const position = new Map(active.map((j, i) => [String(j._id), i]));
  return jobs.map((j) => ({ ...jobOut(j as never), projectName: names.get(String(j.projectId)) ?? "(deleted project)", position: position.get(String(j._id)) ?? null }));
});
