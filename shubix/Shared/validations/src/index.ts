import { z } from "zod";

/** The form + request rules, the same in the website, the phone app and the API (copied from lib/validate.ts). */
export const MIN_PASSWORD = 8;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const emailOk = (s: string) => EMAIL_RE.test(s.trim());
export const passwordOk = (s: string) => s.length >= MIN_PASSWORD;

const email = z.string().min(3).max(254);
const password = z.string().min(1).max(200);
export const loginSchema = z.object({ email, password });
export const registerSchema = z.object({ email, password, ref: z.string().max(40).optional() });
export const forgotSchema = z.object({ email });
export const resetSchema = z.object({ email, code: z.string().min(1).max(12), password });
export const verifySchema = z.object({ code: z.string().min(1).max(12) });
export const changePasswordSchema = z.object({ currentPassword: password, newPassword: password });
export const deleteAccountSchema = z.object({ password, confirm: z.string().max(254) });
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ResetInput = z.infer<typeof resetSchema>;
export * from "./editor";
export * from "./plans";
