import { defineConfig } from "vitest/config";

// Unit and architecture tests for the web app's pure modules (lib/admin/* registries, URL-state grammar) and the static
// guards over the source tree (tests/architecture/*). Browser behaviour stays in Playwright (e2e/).
export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "hooks/**/*.test.ts", "components/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
