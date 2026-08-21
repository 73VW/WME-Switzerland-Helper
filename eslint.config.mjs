import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      ".out/**",
      "releases/**",
      "node_modules/**",
      // add more folders/files as needed
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: { globals: globals.browser },
  },
  tseslint.configs.recommended,
  {
    /**
     * No emoji in the two feature panels.
     *
     * Emoji render at a size and a weight the operating system decides, ignore WME's dark
     * skin, and differ between Windows, macOS and Linux. WME already loads
     * `waze-web-icons.css`, so `icon("road")` from `src/ui/dom.ts` gives the same glyph to
     * every editor, in the current text colour.
     *
     * A lint rule rather than a test: it applies to every file in the two directories,
     * including ones nobody has written yet, and needs no list to keep up to date.
     */
    files: ["src/street-name-checker/**/*.ts", "src/house-number-importer/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u]",
          message:
            "No emoji in the interface: use icon(\"name\") from src/ui/dom.ts (Waze icon font).",
        },
        {
          selector:
            "TemplateElement[value.raw=/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u]",
          message:
            "No emoji in the interface: use icon(\"name\") from src/ui/dom.ts (Waze icon font).",
        },
      ],
    },
  },
]);
