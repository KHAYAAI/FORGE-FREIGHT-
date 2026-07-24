import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * No @vitejs/plugin-react here: its Fast Refresh and HMR wiring is for a dev
 * server, and tests need neither. Vite's own esbuild handles TSX given the
 * automatic JSX runtime, which keeps the toolchain one dependency lighter and
 * off the plugin's vite-major-version treadmill.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
