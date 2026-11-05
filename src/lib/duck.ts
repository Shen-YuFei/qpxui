import * as duckdb from "@duckdb/duckdb-wasm";
import { state } from "../store";
import { api, type ViewInfo } from "./api";

// Bundle the DuckDB WASM + worker assets locally (no CDN), so the desktop
// app keeps working offline. Vite turns these imports into static asset URLs.
import duckdb_wasm_mvp from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdb_wasm_coi from "@duckdb/duckdb-wasm/dist/duckdb-coi.wasm?url";
import coi_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-coi.worker.js?url";
import coi_pthread_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-coi.pthread.worker.js?url";

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdb_wasm_mvp, mainWorker: mvp_worker },
  eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker },
  coi: {
    mainModule: duckdb_wasm_coi,
    mainWorker: coi_worker,
    pthreadWorker: coi_pthread_worker,
  },
};

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;

export async function init() {
  if (db) return;
  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();
}

function safeName(name: string): string {
  // DuckDB identifiers must be quoted; a plain name also acts as the file key.
  const base = name.replace(/\.([a-z0-9]+)$/i, ""); // strip ".parquet"
  return base.replace(/[^\w-]/g, "_");
}

/** Register a view's parquet file and expose it as a DuckDB table.
 *
 * Local files (and files already downloaded to cache) are loaded as buffers.
 * Remote S3 views (`s3://…`) are registered *lazily*: we presign a URL and
 * hand it to DuckDB's HTTP file system, which fetches only the byte ranges a
 * query actually needs — so huge parquet files can be browsed/queried without
 * ever downloading the whole object.
 */
export async function ensureViewReady(view: ViewInfo): Promise<string> {
  await init();
  const table = safeName(view.name);
  if (state.registered.has(view.path)) return table;

  const fileKey = `${table}.parquet`;
  if (view.path.startsWith("s3://")) {
    const bucket = view.path.slice(5).split("/")[0];
    const urls = await api.presignS3Urls(bucket, [view.path]);
    const url = urls[view.path];
    if (!url) throw new Error(`could not presign ${view.path}`);
    // directIO = true: DuckDB streams ranges directly from the URL.
    await db!.registerFileURL(
      fileKey,
      url,
      duckdb.DuckDBDataProtocol.HTTP,
      true
    );
  } else {
    const b64 = await api.readFileBytes(view.path);
    const bytes = base64ToUint8(b64);
    await db!.registerFileBuffer(fileKey, bytes);
  }
  await conn!.query(
    `CREATE OR REPLACE VIEW "${table}" AS SELECT * FROM read_parquet('${fileKey}')`
  );
  state.registered.add(view.path);
  state.tableName[view.path] = table;
  return table;
}

export function base64ToUint8(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Annotate a DuckDB error that looks like a failed *remote/lazy* read with a
 * helpful hint, so the user knows it's usually a CORS/Range issue on the S3
 * bucket rather than a bug in the query.
 */
function guardError(e: unknown): string {
  const msg = String((e as any)?.message ?? e);
  if (
    /access-control|CORS|403|NetworkError|Failed to fetch|Fetch error|range|HTTP error|Unable to connect/i.test(
      msg
    )
  ) {
    return (
      `${msg}\n\n` +
      "Hint: this looks like a blocked remote (lazy) read. If the dataset is on S3, " +
      "enable CORS (with Range support) for this app's origin, or switch the S3 source " +
      "to “Download to cache” which reads over the authenticated backend instead."
    );
  }
  return msg;
}

export type Cell = string | number | boolean | null;

export interface QueryResult {
  columns: string[];
  rows: (Cell | object | unknown[])[][];
  rowCount: number;
  truncated: boolean;
}

/**
 * Is this an Apache Arrow Vector (or a chunk of one)? duckdb-wasm hands back
 * Vector objects for STRUCT / LIST columns that were not materialised into
 * plain JS by `.toArray()`. They expose a `.toArray()` we can call to get
 * friendly JS values, plus `.type.typeId`.
 */
function isArrowVector(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>).toArray === "function" &&
    typeof (v as { type?: { typeId?: unknown } }).type?.typeId === "number"
  );
}

function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "bigint") return Number(v);
  if (t === "string" || t === "number" || t === "boolean") return v;
  if (Array.isArray(v)) return v.map(normalize);
  // Arrow Vector / chunk -> collapse to a friendly JS array of values, then
  // normalise recursively (a LIST of STRUCT becomes [{...}, {...}], not a dump
  // of the Vector's internal buffers).
  if (isArrowVector(v)) {
    let arr: unknown;
    try {
      arr = (v as { toArray: () => unknown }).toArray();
    } catch {
      arr = [];
    }
    return normalize(arr);
  }
  // Typed arrays (Float64Array, Int32Array, …) have numeric-ish elements.
  if (ArrayBuffer.isView(v)) {
    return Array.from(v as unknown as ArrayLike<number>);
  }
  if (t === "object") {
    // Keep STRUCT / MAP values as plain objects so views can render them
    // nicely, only normalising bigints to numbers recursively.
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = normalize(val);
    }
    return out;
  }
  return String(v);
}

type QueryResultType = Awaited<ReturnType<duckdb.AsyncDuckDBConnection["query"]>>;

export async function runSql(
  sql: string,
  maxRows = 5000
): Promise<QueryResult> {
  await init();
  let res: QueryResultType;
  try {
    res = await conn!.query(sql);
  } catch (e) {
    throw new Error(guardError(e));
  }
  let objects: Record<string, unknown>[] = [];
  try {
    objects = res.toArray() as Record<string, unknown>[];
  } catch {
    // Non-row queries (e.g. CREATE/UPDATE) or empty result.
  }
  const truncated = objects.length > maxRows;
  if (truncated) objects = objects.slice(0, maxRows);

  const columns = objects.length ? Object.keys(objects[0]) : [];
  const rows = objects.map((o) => columns.map((c) => normalize(o[c]) as never));
  return {
    columns,
    rows,
    rowCount: objects.length,
    truncated,
  };
}

export async function countRows(table: string): Promise<number> {
  await init();
  let res: QueryResultType;
  try {
    res = await conn!.query(`SELECT COUNT(*) AS n FROM "${table}"`);
  } catch (e) {
    throw new Error(guardError(e));
  }
  const objects = res.toArray() as { n: string | number }[];
  return Number(objects[0]?.n ?? 0);
}

export interface ColumnInfo {
  name: string;
  type: string;
}

/** Read column names + DuckDB types via DESCRIBE. */
export async function describeTable(table: string): Promise<ColumnInfo[]> {
  await init();
  let res: QueryResultType;
  try {
    res = await conn!.query(`DESCRIBE "${table}"`);
  } catch (e) {
    throw new Error(guardError(e));
  }
  const objects = res.toArray() as Record<string, unknown>[];
  return objects.map((o) => ({
    name: String(o["column_name"] ?? ""),
    type: String(o["column_type"] ?? ""),
  }));
}
