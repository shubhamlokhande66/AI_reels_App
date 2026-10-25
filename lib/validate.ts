/** The forms' rules, the same everywhere (sign in, create an account, reset and change a password). */
export const MIN_PASSWORD = 8;
export const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
export const passwordOk = (s: string) => s.length >= MIN_PASSWORD;
