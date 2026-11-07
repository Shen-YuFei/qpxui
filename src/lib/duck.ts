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

let initPromise: Promise<void> | null = null;
/** Engine queries and registrations still running, and the engine they run on. */
let pending = 0;
let generation = 0;
/** Rejections for in-flight `tracked` calls, so abandonment settles them. */
const trackedCancels = new Set<(e: unknown) => void>();

async function tracked<T>(fn: () => Promise<T>): Promise<T> {
  const gen = generation;
  pending++;
  let rejectFn: (e: unknown) => void = () => {};
  // `cancelled` settles as soon as abandonQueries() runs: a query that was
  // running when the worker was killed would otherwise never resolve (duckdb-wasm
  // terminate() leaves pending requests hanging forever), leaving loading flags
  // stuck. Raced against the real work so a normal result still wins.
  const cancelled = new Promise<never>((_, reject) => {
    rejectFn = reject;
    trackedCancels.add(reject);
  });
  try {
    return await Promise.race([fn(), cancelled]);
  } finally {
    trackedCancels.delete(rejectFn);
    if (gen === generation) pending--;
  }
}

/** Stop whatever the engine is doing (duckdb-wasm runs one query at a time, so
 * a long scan of the previous dataset would hold up the next one). Kills the
 * worker when something is running; the next query starts a fresh engine.
 * Returns true when it restarted, so callers drop tables and cached results. */
export function abandonQueries(): boolean {
  if (!pending || !db) return false;
  const old = db;
  db = null;
  conn = null;
  initPromise = null;
  pending = 0;
  generation++;
  const toCancel = Array.from(trackedCancels);
  trackedCancels.clear();
  for (const r of toCancel) r(new Error("cancelled"));
  void old.terminate().catch(() => {});
  return true;
}

// Concurrent callers share one initialisation, so nobody sees a half-ready db.
export function init(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit();
    initPromise.catch(() => (initPromise = null));
  }
  return initPromise;
}

async function doInit() {
  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const d = new duckdb.AsyncDuckDB(logger, worker);
  await d.instantiate(bundle.mainModule, bundle.pthreadWorker);
  // Remote (streamed) files must be read with range requests only. With the
  // defaults, duckdb-wasm may fall back to GETting the whole object.
  await d.open({
    filesystem: { reliableHeadRequests: true, allowFullHTTPReads: false, forceFullHTTPReads: false },
  });
  conn = await d.connect();
  // Prefetch whole column chunks of a row group in one go instead of many
  // small reads: far fewer round trips for streamed (remote) parquet files.
  await conn.query("SET prefetch_all_parquet_files = true");
  db = d;
  if (import.meta.env.DEV) (window as any).__duck = { db: d, conn };
}

function safeName(name: string): string {
  // DuckDB identifiers must be quoted; a plain name also acts as the file key.
  const base = name.replace(/\.([a-z0-9]+)$/i, ""); // strip ".parquet"
  return base.replace(/[^\w-]/g, "_");
}

/** Register a view's parquet file and expose it as a DuckDB table.
 *
 * Local files (and files already downloaded to cache) are range-read from
 * disk through the backend proxy (falling back to a whole-file buffer).
 * Remote S3 views (`s3://…`) are registered *lazily*: the Rust backend runs a
 * 127.0.0.1 range proxy that fetches byte ranges from S3 with the user's
 * credentials, and DuckDB's HTTP file system asks it only for the ranges a
 * query needs (parquet footer, then the touched column chunks). Huge files
 * open instantly, nothing is downloaded up front, and the bucket needs no CORS.
 */
export async function ensureViewReady(view: ViewInfo): Promise<string> {
  await init();
  const table = safeName(view.name);
  if (state.registered.has(view.path)) return table;
  const gen = generation;
  await tracked(() => register(view, table));
  // The engine was restarted meanwhile: the table belongs to the old one.
  if (gen !== generation) throw new Error("cancelled");
  state.registered.add(view.path);
  state.tableName[view.path] = table;
  return table;
}

async function register(view: ViewInfo, table: string): Promise<void> {
  // Bind this engine: a restart meanwhile must not touch the new one.
  const { db, conn } = await initDb();

  const fileKey = `${table}.parquet`;
  if (view.path.startsWith("s3://")) {
    const bucket = view.path.slice(5).split("/")[0];
    let url: string | undefined;
    try {
      url = (await api.streamS3Urls(bucket, [view.path]))[view.path]?.url;
    } catch (e) {
      // Fall back to a presigned URL read directly by the webview (needs CORS).
      console.warn("stream proxy unavailable, falling back to presigned URL", e);
      url = (await api.presignS3Urls(bucket, [view.path]))[view.path];
    }
    if (!url) throw new Error(`could not open ${view.path} for streaming`);
    // Still range requests only (allowFullHTTPReads is off), but with
    // directIO = false duckdb-wasm keeps the ranges it read, so later queries
    // over the same columns don't go back to the network.
    await db.registerFileURL(fileKey, url, duckdb.DuckDBDataProtocol.HTTP, false);
  } else if (/^https?:\/\//.test(view.path)) {
    // Public portal file: same lazy range proxy, fetched over HTTPS.
    const url = (await api.streamHttpUrls([view.path]))[view.path]?.url;
    if (!url) throw new Error(`could not open ${view.path} for streaming`);
    await db.registerFileURL(fileKey, url, duckdb.DuckDBDataProtocol.HTTP, false);
  } else {
    // Local parquet: range-read from disk through the same proxy, so big
    // files open instantly and only the touched column chunks are read.
    let url: string | undefined;
    try {
      url = (await api.streamLocalFiles([view.path]))[view.path]?.url;
    } catch (e) {
      console.warn("local range proxy unavailable, loading the whole file", e);
    }
    if (url) {
      await db.registerFileURL(fileKey, url, duckdb.DuckDBDataProtocol.HTTP, false);
    } else {
      const bytes = base64ToUint8(await api.readFileBytes(view.path));
      await db.registerFileBuffer(fileKey, bytes);
    }
  }
  await conn.query(
    `CREATE OR REPLACE VIEW "${table}" AS SELECT * FROM read_parquet('${fileKey}')`
  );
}

async function initDb(): Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection }> {
  await init();
  return { db: db!, conn: conn! };
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
      "Hint: this looks like a failed remote (streamed) read — check your AWS credentials " +
      "and network, or use “Download to cache” for this view instead."
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
  if (v instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of v) out[String(k)] = normalize(val);
    return out;
  }
  // Arrow rows (StructRow / MapRow) expose toJSON() with the real fields.
  if (typeof (v as { toJSON?: unknown }).toJSON === "function" && !(v instanceof Date)) {
    try {
      const j = (v as { toJSON: () => unknown }).toJSON();
      if (j !== v) return normalize(j);
    } catch {
      /* fall through */
    }
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

/** Dev builds keep a log of query timings in `window.__qlog`. */
function logQuery(sql: string, ms: number, rows: number) {
  const w = window as any;
  (w.__qlog ??= []).push({ ms: Math.round(ms), rows, sql: sql.replace(/\s+/g, " ").trim() });
}

type QueryResultType = Awaited<ReturnType<duckdb.AsyncDuckDBConnection["query"]>>;

export async function runSql(
  sql: string,
  maxRows = 5000
): Promise<QueryResult> {
  await init();
  let res: QueryResultType;
  const t0 = performance.now();
  const w = window as any;
  if (import.meta.env.DEV) w.__qpending = (w.__qpending ?? 0) + 1;
  try {
    const c = conn!;
    res = await tracked(() => c.query(sql));
  } catch (e) {
    throw new Error(guardError(e));
  } finally {
    if (import.meta.env.DEV) w.__qpending--;
  }
  if (import.meta.env.DEV) logQuery(sql, performance.now() - t0, res.numRows);
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
    const c = conn!;
    res = await tracked(() => c.query(`SELECT COUNT(*) AS n FROM "${table}"`));
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
    const c = conn!;
    res = await tracked(() => c.query(`DESCRIBE "${table}"`));
  } catch (e) {
    throw new Error(guardError(e));
  }
  const objects = res.toArray() as Record<string, unknown>[];
  return objects.map((o) => ({
    name: String(o["column_name"] ?? ""),
    type: String(o["column_type"] ?? ""),
  }));
}
