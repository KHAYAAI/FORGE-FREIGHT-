// @ts-check
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/storage/**",
      "**/*.config.{js,mjs,ts}",
      // Next.js-generated, regenerated on every build — not ours to lint.
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Catches real bugs (unused imports/vars from refactors); underscore-
      // prefixed names are the escape hatch for intentionally-unused params.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Tuned for React Compiler's memoization assumptions on client
      // components; our async Server Component pages use `let x; ... .catch
      // (() => { x = ... })` to surface fetch errors, which runs once on the
      // server per request and isn't the mutation-during-render this rule
      // targets. False positive here, not a real hazard.
      "react-hooks/immutability": "off",
    },
  },
);
