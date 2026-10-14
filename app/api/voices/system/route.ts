import { route } from "@/server/core/http";
import { systemVoices } from "@/server/voice";

/** What can speak on this machine (and the natural AI voices), and which languages are covered. */
export const GET = route(async () => systemVoices());
