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
  // Layers: lib (backend calls, the DuckDB engine, queries, pure helpers)
  // knows neither the store nor components; the store knows no components;
  // components reach the backend and run SQL only through lib.
  {
    files: ["src/lib/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["**/store", "**/components/**"], message: "lib must not depend on the store or on components." }],
      }],
    },
  },
  {
    files: ["src/store.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["**/components/**"], message: "The store must not depend on components." }],
      }],
    },
  },
  {
    files: ["src/components/**", "src/App.vue"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@tauri-apps/*"], message: "Components reach the backend through lib (api, progress, downloads)." },
          { group: ["**/lib/duck"], importNames: ["runSql"], message: "Components run SQL through lib/queries." },
          { group: ["**/lib/report"], importNames: ["cachedSql"], message: "Components run SQL through lib/queries." },
        ],
      }],
    },
  },
);
