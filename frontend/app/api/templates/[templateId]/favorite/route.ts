import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { favoriteTemplate } from "@/server/workspace";

export const PUT = route<{ templateId: string }>(async (req, { templateId }) => favoriteTemplate(templateId, (await body(req, z.object({ favorite: z.boolean() }))).favorite));
