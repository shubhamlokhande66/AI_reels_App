/** The administrator's wording for the studio, shared by its parts: words → the admin's words (only the changed ones;
 * FastStudio.tsx fills it from Admin → CMS). `tx("Next")` is what to show for "Next". */
let swaps = new Map<string, string>();
export const setStudioWords = (m: Map<string, string>) => { swaps = m; };
export const studioWords = () => swaps;
export const tx = (s: string) => swaps.get(s.trim()) ?? s;
