/** Small platform-neutral helpers. */
export const normalizeEmail = (s: string) => s.trim().toLowerCase();
/** "sh••••@gmail.com" */
export const maskEmail = (s: string) => s.replace(/^([^@]{1,2})[^@]*(@.*)$/, (_m, a: string, b: string) => `${a}${"•".repeat(4)}${b}`);
/** "{email}" placeholders in a CMS text */
export const fill = (text: string, vars: Record<string, string | number> = {}) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
