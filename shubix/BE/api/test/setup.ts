// Tests never send real email: server/core/config.ts reads the .env files, and a test that makes an affiliate request,
// a purchase or a broadcast would otherwise mail the real administrators through the real SMTP. Real environment
// variables win over .env, so empty ones turn email off (it goes to the log instead).
for (const k of ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FALLBACK_HOST", "SMTP_FALLBACK_FROM", "SMTP_FALLBACK_USER", "SMTP_FALLBACK_PASSWORD"]) process.env[k] = "";

// Nor reach the real AI providers, storage or payments, or the real database: tests that need Mongo set their own server.
for (const k of ["OPENAI_API_KEY", "GEMINI_API_KEY", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "CLOUDFLARE_API_TOKEN", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) process.env[k] = "";
process.env.MONGODB_URI = "mongodb://127.0.0.1:1/tests-must-use-their-own-server";

// Auth-enabled test fixtures sign cookies; never depend on a developer's local .env secret.
process.env.SECRET_KEY = "shubix-vitest-only-secret-not-for-deployment";
