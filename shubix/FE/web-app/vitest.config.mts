import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    // the studio's own tests sit beside its code (the director, the visual intent): they run too
    include: ["tests/**/*.test.{ts,tsx}", "components/**/*.test.{ts,tsx}"],
    // UI tests that pass in 1-2 s alone can pass 5 s when the whole suite runs at once on a busy machine
    testTimeout: 20_000,
  },
});
