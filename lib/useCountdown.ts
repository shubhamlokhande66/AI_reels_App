"use client";

import { useEffect, useState } from "react";

/** Seconds left before something may be done again (a code resent): counts down to 0; `start(n)` begins again. */
export function useCountdown(initial = 0) {
  const [until, setUntil] = useState(() => (initial > 0 ? Date.now() + initial * 1000 : 0));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= now) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [until, now]);
  return { left: Math.max(0, Math.ceil((until - now) / 1000)), start: (s: number) => { setNow(Date.now()); setUntil(Date.now() + s * 1000); } };
}
