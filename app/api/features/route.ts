import { route } from "@/server/core/http";
import { getFeatures } from "@/server/core/features";

/** Which parts of the app are on (everyone may read it: the app hides what is off). */
export const GET = route(async () => getFeatures());
