import { route } from "../../../../../../server/core/http";
import { convertFile } from "../../../../../../server/studio/convert";

/** The converted clip (H.264 MP4, or VP9 WebM when asked), kept 15 minutes after it is done. */
export const GET = route<{ id: string }>(async (req, { id }) => convertFile(req, id));
