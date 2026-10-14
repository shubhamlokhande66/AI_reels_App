import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { deleteTemplate, TemplateIn, updateTemplate } from "@/server/workspace";

export const PATCH = route<{ templateId: string }>(async (req, { templateId }) => updateTemplate(templateId, await body(req, TemplateIn)));
export const DELETE = route<{ templateId: string }>(async (_req, { templateId }) => { await deleteTemplate(templateId); return undefined; });
