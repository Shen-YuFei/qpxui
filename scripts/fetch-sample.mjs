#!/usr/bin/env node
// Downloads a tiny QPX example dataset (two parquet views) into ./sample
// so you can try the viewer without converting anything yourself.
// Uses only the global fetch (Node 18+).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "sample");

const files = [
  [
    "https://raw.githubusercontent.com/bigbio/qpx/main/docs/include/example.feature.parquet",
    "example.feature.parquet",
  ],
  [
    "https://raw.githubusercontent.com/bigbio/qpx/main/docs/include/example.psm.parquet",
    "example.psm.parquet",
  ],
];

await mkdir(outDir, { recursive: true });

for (const [url, name] of files) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`!! Failed to download ${name} (${res.status})`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(join(outDir, name), buf);
  console.log(`✓ ${name}  (${(buf.length / 1024).toFixed(1)} KB)`);
}

console.log(`\nSample dataset ready in: ${outDir}`);
console.log("Open it in the app via 'New source → Folder / collection' and pick this folder.");
