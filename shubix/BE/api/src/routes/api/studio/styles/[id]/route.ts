import { route } from "../../../../../server/core/http";
import { deleteStyle } from "../../../../../server/studio/styles";

export const DELETE = route<{ id: string }>(async (_req, { id }) => deleteStyle(id));
