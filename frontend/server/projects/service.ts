import "server-only";
import type { Document, ObjectId } from "mongodb";
import { db, parseId } from "@/server/core/db";
import { ConflictError, NotFoundError } from "@/server/core/errors";
import { deletePrefix } from "@/server/storage/local";
import SETTINGS_DEFAULTS from "./settings-defaults.json";

/** Projects: reading, listing, deleting, and the JSON the app gets for them - field for field what the Python backend
 * returned (backend/app/services/project_service.py, schemas/project.py). */

type Doc = Document & { _id: ObjectId };

/** Plain JSON: ObjectIds as their hex, dates as ISO strings, everywhere inside. */
export function plain(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && (v as { _bsontype?: string })._bsontype === "ObjectId") return String(v);
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plain(x)]));
  return v;
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d);

export function mediaUrl(projectId: unknown, mediaId: unknown) {
  return `/api/projects/${projectId}/media/${mediaId}/file`;
}

export function mediaOut(m: Doc) {
  const pid = m.projectId, mid = m._id;
  return {
    id: String(mid), kind: m.kind, name: m.originalName, size: m.size, mimeType: m.mimeType ?? "",
    duration: m.duration ?? null, width: m.width ?? null, height: m.height ?? null, fps: m.fps ?? null,
    analysis: plain(m.analysisSummary ?? null), url: mediaUrl(pid, mid),
    thumbnailUrl: m.thumbnailKey && !m.purged ? `/api/projects/${pid}/media/${mid}/thumbnail` : null,
    purged: Boolean(m.purged),
  };
}

export function renderingOut(r: Doc) {
  const base = `/api/projects/${r.projectId}/renderings/${r._id}/file`;
  return {
    id: String(r._id), projectId: String(r.projectId), style: r.style, duration: r.duration, width: r.width, height: r.height,
    size: r.size, label: r.label ?? "", kind: r.kind ?? "final", timelineVersion: r.timelineVersion ?? 1, createdAt: iso(r.createdAt),
    url: base, downloadUrl: `${base}?download=1`, postCopy: plain(r.postCopy ?? null), performance: plain(r.performance ?? null),
  };
}

export function jobOut(j: Doc) {
  return {
    id: String(j._id), projectId: String(j.projectId), type: j.type, status: j.status, progress: j.progress, stage: j.stage,
    stages: plain(j.stages ?? []), error: plain(j.error ?? null), renderingId: j.renderingId ? String(j.renderingId) : null,
    createdAt: iso(j.createdAt), updatedAt: iso(j.updatedAt),
  };
}

/** The stored settings over the defaults (older projects miss newer fields; Python filled them the same way). */
export function settingsOut(stored: Record<string, unknown> | undefined) {
  return { ...SETTINGS_DEFAULTS, ...plain(stored ?? {}) as object };
}

export async function getProjectDoc(projectId: string): Promise<Doc> {
  const oid = parseId(projectId, "Project");
  const doc = await (await db()).collection("projects").findOne({ _id: oid });
  if (!doc) throw new NotFoundError("Project not found.", { code: "PROJECT_NOT_FOUND" });
  return doc as Doc;
}

export async function projectOut(doc: Doc) {
  const d = await db();
  const media = new Map<string, Doc>();
  for (const m of await d.collection("media").find({ projectId: doc._id }).toArray()) media.set(String(m._id), m as Doc);
  const pick = (ids: unknown[] | undefined) => (ids ?? []).map(String).filter((i) => media.has(i)).map((i) => mediaOut(media.get(i)!));
  const one = async (col: string, id: unknown) => (id ? ((await d.collection(col).findOne({ _id: id as ObjectId })) as Doc | null) : null);
  const [out, prev, job] = await Promise.all([one("renderings", doc.latestRenderingId), one("renderings", doc.previewRenderingId), one("jobs", doc.latestJobId)]);
  const audio = doc.audioId && media.has(String(doc.audioId)) ? mediaOut(media.get(String(doc.audioId))!) : null;
  return {
    id: String(doc._id), name: doc.name, status: doc.status, settings: settingsOut(doc.settings),
    videos: pick(doc.videoOrder), images: pick(doc.imageOrder), reelPlan: plain(doc.reelPlan ?? null), productPlan: plain(doc.productPlan ?? null),
    audio, analysis: plain(doc.analysis ?? null), timeline: plain(doc.timeline ?? null), timelineVersion: doc.timelineVersion ?? 0,
    preview: prev ? renderingOut(prev) : null, output: out ? renderingOut(out) : null, latestJob: job ? jobOut(job) : null,
    error: plain(doc.error ?? null), createdAt: iso(doc.createdAt), updatedAt: iso(doc.updatedAt),
  };
}

export async function listProjects(status: string | null, limit: number) {
  const d = await db();
  const docs = (await d.collection("projects").find(status ? { status } : {}).sort({ updatedAt: -1 }).limit(limit).toArray()) as Doc[];
  // the first clip of every project in one query (was one query per project)
  const firstIds = docs.map((p) => (p.videoOrder ?? [])[0]).filter(Boolean);
  const thumbs = new Map<string, boolean>();
  for (const m of await d.collection("media").find({ _id: { $in: firstIds } }, { projection: { thumbnailKey: 1 } }).toArray()) thumbs.set(String(m._id), Boolean(m.thumbnailKey));
  return docs.map((p) => {
    const first = (p.videoOrder ?? [])[0];
    return {
      id: String(p._id), name: p.name, status: p.status, style: p.settings?.style, duration: p.settings?.duration,
      videoCount: (p.videoOrder ?? []).length,
      thumbnailUrl: first && thumbs.get(String(first)) ? `/api/projects/${p._id}/media/${first}/thumbnail` : null,
      outputUrl: p.latestRenderingId ? `/api/projects/${p._id}/renderings/${p.latestRenderingId}/file` : null,
      createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt),
    };
  });
}

export async function deleteProject(projectId: string) {
  const doc = await getProjectDoc(projectId);
  if (doc.status === "processing") throw new ConflictError("Cannot delete a project while it is processing.", { code: "PROJECT_BUSY" });
  const d = await db();
  await Promise.all(["media", "jobs", "renderings"].map((c) => d.collection(c).deleteMany({ projectId: doc._id })));
  await d.collection("projects").deleteOne({ _id: doc._id });
  deletePrefix(`projects/${projectId}`);
}
