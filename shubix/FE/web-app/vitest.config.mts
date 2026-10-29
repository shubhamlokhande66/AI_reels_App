import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // server code imports "server-only" (it must never reach the browser); in tests it is a no-op
  resolve: { alias: { "@": import.meta.dirname, "server-only": `${import.meta.dirname}/tests/stubs/server-only.ts` } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    // UI tests that pass in 1-2 s alone can pass 5 s when the whole suite runs at once on a busy machine
    testTimeout: 20_000,
  },
});
