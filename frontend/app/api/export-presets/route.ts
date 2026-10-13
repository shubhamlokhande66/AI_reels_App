import { route } from "@/server/core/http";
import REGISTRY from "@/server/video/registry.json";

export const GET = route(async () => REGISTRY.exportPresets);
