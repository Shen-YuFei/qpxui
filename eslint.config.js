import js from "@eslint/js";
import globals from "globals";
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/", "node_modules/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs["flat/essential"],
  {
    files: ["**/*.vue"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  { files: ["src/**"], languageOptions: { globals: globals.browser } },
  { files: ["scripts/**", "*.config.*"], languageOptions: { globals: globals.node } },
  {
    // Query rows come back from DuckDB untyped and ECharts callbacks take
    // loosely typed params, so `any` is allowed at those boundaries.
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
