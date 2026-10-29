import { defineConfig } from "vitest/config";

const src = `${import.meta.dirname}/src`;
export default defineConfig({
  // tests mock modules by their old names (vi.mock("@/server/core/mail")): the same files as the relative imports
  resolve: { alias: { "@/server": `${src}/server`, "server-only": `${import.meta.dirname}/test/stubs/server-only.ts` } },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
