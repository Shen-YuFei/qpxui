/// <reference types="vite/client" />

// The duckdb-wasm bundle ships a CoiServiceWorker that needs this global
// when running with shared memory / pthread support.
declare const __coi_serviceworker__: string | undefined;
