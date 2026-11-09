import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as duckdb from "@duckdb/duckdb-wasm/dist/duckdb-node-blocking";

// Pin signed extensions to the engine embedded in the installed npm package.
const VERSION = "v1.4.3";
const SHA256 = {
  wasm_eh: "22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55",
  wasm_mvp: "0785c6c95d003eff4faa7b3b4b660f02c9c92f6d68d135ddf330d42e3a650600",
};
const root = new URL("../public/duckdb-extensions/", import.meta.url);
const require = createRequire(import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function checkVersion() {
  const db = await duckdb.createDuckDB(
    { mvp: { mainModule: require.resolve("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm") } },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  const actual = db.getVersion();
  if (actual !== VERSION) {
    throw new Error(`DuckDB engine is ${actual}, expected ${VERSION}. Update VERSION and SHA256 in this script.`);
  }
}

async function fetchExtension(platform, expected) {
  const path = `${VERSION}/${platform}/parquet.duckdb_extension.wasm`;
  const target = new URL(path, root);
  let existing;
  try {
    existing = await readFile(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing) {
    if (hash(existing) !== expected) throw new Error(`SHA-256 mismatch: ${target.pathname}. Remove it and rebuild.`);
    console.log(`Verified ${path} (cached)`);
    return;
  }
  const response = await fetch(`https://extensions.duckdb.org/${path}`);
  if (!response.ok) throw new Error(`Download failed for ${path}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== expected) throw new Error(`SHA-256 mismatch: downloaded ${path}`);
  await mkdir(new URL(".", target), { recursive: true });
  await writeFile(target, bytes);
  console.log(`Downloaded and verified ${path}`);
}

await checkVersion();
for (const [platform, expected] of Object.entries(SHA256)) await fetchExtension(platform, expected);
