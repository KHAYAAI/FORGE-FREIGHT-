import { execFileSync } from "node:child_process";

/**
 * Brings the schema up to date before the integration suite runs.
 *
 * `drizzle-kit push` is the same command the dev and deploy paths use, so the
 * suite exercises the schema as it is actually applied rather than a
 * hand-maintained test fixture that could drift from it.
 */
export async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      [
        "Integration tests need DATABASE_URL.",
        "Locally:  pnpm dev:infra && DATABASE_URL=postgres://forge:forge@localhost:5432/forge_freight pnpm test:integration",
        "They write to whatever database you point them at, so do not point them at production.",
      ].join("\n"),
    );
  }

  execFileSync("pnpm", ["--filter", "@forge-freight/db", "migrate", "--force"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
