import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

// Tests never send real email: server/core/config.ts reads the project's .env, and a test that makes an affiliate request,
// a purchase or a broadcast would otherwise mail the real administrators (e.g. "New affiliate request: pro@x.com") through
// the real SMTP. Real environment variables win over .env, so empty ones turn email off (it goes to the log instead).
for (const k of ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FALLBACK_HOST", "SMTP_FALLBACK_FROM", "SMTP_FALLBACK_USER", "SMTP_FALLBACK_PASSWORD"]) process.env[k] = "";

// jsdom's object-URL support throws for File objects, so always stub it.
URL.createObjectURL = vi.fn(() => "blob:mock");
URL.revokeObjectURL = vi.fn();
