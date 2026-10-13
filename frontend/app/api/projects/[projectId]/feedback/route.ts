import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { FeedbackIn, giveFeedback } from "@/server/workspace";

export const POST = route<{ projectId: string }>(async (req, { projectId }) => Response.json(await giveFeedback(projectId, await body(req, FeedbackIn)), { status: 201 }));
