import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.js",
            "vitest.config.ts",
            "packages/*/vitest.config.ts",
            "apps/*/vitest.config.ts",
            "apps/web/vite.config.ts",
            "apps/web/playwright.config.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Every word the editor shows comes from the language files (src/i18n), never from JSX.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[value=/\\p{L}/u]",
          message: "Put this text in apps/web/src/i18n and use t.… instead.",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=/\\p{L}/u]",
          message: "Put this text in apps/web/src/i18n and use t.… instead.",
        },
      ],
    },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
