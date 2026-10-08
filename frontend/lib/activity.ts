/** How many actions (non-GET requests and uploads) are on their way to the server right now; the GlobalActivity bar
 * shows while this is above zero, so every click that does something gives visible feedback. */
let count = 0;
const listeners = new Set<() => void>();

export function subscribeActivity(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function activityCount() {
  return count;
}

export async function tracked<T>(work: Promise<T>): Promise<T> {
  count += 1;
  listeners.forEach((fn) => fn());
  try {
    return await work;
  } finally {
    count -= 1;
    listeners.forEach((fn) => fn());
  }
}
