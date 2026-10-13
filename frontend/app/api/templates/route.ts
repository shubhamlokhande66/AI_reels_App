import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { createTemplate, listTemplates, TemplateIn } from "@/server/workspace";

export const GET = route(async () => listTemplates());
export const POST = route(async (req) => Response.json(await createTemplate(await body(req, TemplateIn)), { status: 201 }));
