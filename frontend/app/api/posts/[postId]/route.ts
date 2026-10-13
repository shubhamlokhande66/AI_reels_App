import { route } from "@/server/core/http";
import { cancelPost } from "@/server/publish";

export const DELETE = route<{ postId: string }>(async (_req, { postId }) => cancelPost(postId));
