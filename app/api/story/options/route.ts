import { route } from "@/server/core/http";
import { storyOptions } from "@/server/story";

/** Art styles, narrators and which picture sources are connected. */
export const GET = route(async () => storyOptions());
