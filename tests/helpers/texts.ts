import { fill, TEXT_DEFAULTS } from "@/lib/texts";

/** useT() for tests: the default texts (lib/texts.ts), as a page shows them before the administrator changes any. */
export const tDefaults = (key: string, vars?: Record<string, string | number>) => fill(TEXT_DEFAULTS[key] ?? key, vars);
