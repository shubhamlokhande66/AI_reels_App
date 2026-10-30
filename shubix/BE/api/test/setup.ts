// Tests never send real email: server/core/config.ts reads the .env files, and a test that makes an affiliate request,
// a purchase or a broadcast would otherwise mail the real administrators through the real SMTP. Real environment
// variables win over .env, so empty ones turn email off (it goes to the log instead).
for (const k of ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FALLBACK_HOST", "SMTP_FALLBACK_FROM", "SMTP_FALLBACK_USER", "SMTP_FALLBACK_PASSWORD"]) process.env[k] = "";

// Auth-enabled test fixtures sign cookies; never depend on a developer's local .env secret.
process.env.SECRET_KEY = "shubix-vitest-only-secret-not-for-deployment";
