import { route } from "@/server/core/http";
import { projectPosts } from "@/server/publish";

export const GET = route<{ projectId: string }>(async (_req, { projectId }) => projectPosts(projectId));
