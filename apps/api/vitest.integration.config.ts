import { defineConfig } from "vitest/config";

/**
 * Integration suite: runs against a real Postgres, kept separate from the unit
 * suite so `pnpm test` stays runnable with nothing installed.
 *
 * Files run sequentially against one database. They use disjoint fixtures, so
 * they would mostly survive parallel execution, but "mostly" is the wrong
 * property for the suite whose job is to catch isolation bugs.
 */
export default defineConfig({
  test: {
    include: ["test-integration/**/*.test.ts"],
    globalSetup: ["test-integration/global-setup.ts"],
    fileParallelism: false,
    // Schema push plus real round-trips; the unit-suite default is too tight.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
