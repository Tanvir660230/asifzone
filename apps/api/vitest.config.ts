import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15000,
    // Tests must never call a real mail provider: with a live RESEND_API_KEY in a developer's .env, the customer tests
    // hit Resend over the network (which rejects example.com and is timing-dependent). An empty key — dotenv won't
    // override a defined variable — makes the mailer use its write-to-disk fallback, so the suite is hermetic.
    env: { RESEND_API_KEY: "" },
  },
});
