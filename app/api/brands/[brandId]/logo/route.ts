import { route, sendFile } from "@/server/core/http";
import { logoFile, uploadLogo } from "@/server/brands";

export const GET = route<{ brandId: string }>(async (req, { brandId }) => sendFile(req, await logoFile(brandId), "image/png"));
export const POST = route<{ brandId: string }>(async (req, { brandId }) => uploadLogo(brandId, req));
