/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

// The duckdb-wasm bundle ships a CoiServiceWorker that needs this global
// when running with shared memory / pthread support.
declare const __coi_serviceworker__: string | undefined;
