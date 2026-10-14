import { route } from "@/server/core/http";
import { pricing } from "@/server/workspace";

/** Plans, credits and prices (public: the pricing page is shown before sign-in). */
export const GET = route(async () => pricing());
