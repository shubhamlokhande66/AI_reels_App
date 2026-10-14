import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { deleteReference, updateReference } from "@/server/trends/references";

export const PATCH = route<{ refId: string }>(async (req, { refId }) => updateReference(refId, await body(req, z.object({ name: z.string().min(1).max(80).nullable().default(null), notes: z.string().max(300).nullable().default(null) }))));
export const DELETE = route<{ refId: string }>(async (_req, { refId }) => { await deleteReference(refId); return undefined; });
