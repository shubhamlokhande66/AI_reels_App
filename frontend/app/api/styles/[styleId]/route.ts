import { route } from "@/server/core/http";
import { getStyle } from "@/server/styles";
import { styleDetail } from "@/server/workspace";

export const GET = route<{ styleId: string }>(async (_req, { styleId }) => styleDetail(getStyle(styleId)));
