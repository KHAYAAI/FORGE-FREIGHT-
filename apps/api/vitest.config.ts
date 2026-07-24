import { defineConfig } from "vitest/config";

/**
 * Unit suite only. `test-integration/` needs a live Postgres and runs under
 * `vitest.integration.config.ts` via `pnpm test:integration`; without this
 * bound the default glob would sweep those files into `pnpm test` and fail for
 * anyone who hasn't started a database.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
