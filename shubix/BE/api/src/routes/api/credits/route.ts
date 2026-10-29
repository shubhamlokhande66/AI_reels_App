import { route } from "../../../server/core/http";
import { myCredits } from "../../../server/credits";

/** The signed-in user's credits, plan and recent history (enabled: false when billing is off or nobody is signed in;
 * billing tells the two apart). */
export const GET = route(async () => myCredits());
