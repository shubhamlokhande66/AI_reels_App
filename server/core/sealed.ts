import "server-only";
import crypto from "node:crypto";
import { settings } from "./config";
import { AppError } from "./errors";

/** Sensitive values kept encrypted in the database (an affiliate's bank account and UPI ID): AES-256-GCM with a key made
 * from SECRET_KEY (a server secret, never in the database) and the value's purpose. A database copy or backup alone
 * cannot read them. A new SECRET_KEY makes the old ones unreadable (the person enters them again). */

const key = (purpose: string) => {
  if (!settings.secretKey) throw new AppError("SECRET_KEY is not set on the server.", { code: "SECRET_KEY_MISSING", status: 500 });
  return crypto.createHash("sha256").update(`shubix-sealed:${purpose}:${settings.secretKey}`).digest();
};

export function seal(purpose: string, value: unknown): string {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(purpose), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url")}`;
}

/** the value, or null when it cannot be read (another SECRET_KEY, or changed) */
export function unseal<T>(purpose: string, sealed: string): T | null {
  try {
    if (!sealed.startsWith("v1.")) return null;
    const raw = Buffer.from(sealed.slice(3), "base64url"), d = crypto.createDecipheriv("aes-256-gcm", key(purpose), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8")) as T;
  } catch { return null; }
}
