import { route } from "@/server/core/http";
import { listProductStyles } from "@/server/product/director";

export const GET = route(async () => listProductStyles().map((s) => ({ id: s.id, name: s.name, description: s.description })));
