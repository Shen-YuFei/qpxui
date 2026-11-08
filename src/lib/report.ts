// Dataset-level reports and search: resolves which QPX views a dataset has,
// and builds column-selective SQL so streamed (lazy) views only fetch the
// column chunks a chart actually needs.

import type { DatasetInfo, ViewInfo } from "./api";
import { describeTable, ensureViewReady, runSql, type QueryResult } from "./duck";
import { fmtNum, scalarText } from "./format";
import { COL, SORT_ORDER_KEY, VIEW_KINDS, type ViewKind } from "./qpx";

export interface TableRef {
  view: ViewInfo;
  table: string;
  cols: Set<string>;
  /** Lower-cased column name -> DuckDB type. */
  types: Record<string, string>;
  /** Expression for the plain amino-acid sequence (see detectSeqExpr). */
  seq: string;
}

export type DatasetTables = Partial<Record<ViewKind, TableRef>>;

const tablesCache = new Map<string, Promise<DatasetTables>>();
const sqlCache = new Map<string, Promise<QueryResult>>();

function dsKey(ds: DatasetInfo): string {
  return `${ds.path}::${ds.prefix}`;
}

/** Register every QPX view of a dataset that the reports use. Only the parquet
 * footer is read for streamed views. */
export function datasetTables(ds: DatasetInfo): Promise<DatasetTables> {
  const key = dsKey(ds);
  let p = tablesCache.get(key);
  if (!p) {
    p = (async () => {
      const views = VIEW_KINDS.flatMap((kind) => {
        const view = ds.views.find((v) => v.view === kind && v.format === "parquet");
        return view ? [{ kind, view }] : [];
      });
      // Registering waits on the backend (a network round trip for remote
      // files), so register every view at once.
      const tables = await Promise.all(views.map(({ view }) => ensureViewReady(view)));
      const out: DatasetTables = {};
      for (const [i, { kind, view }] of views.entries()) {
        const table = tables[i];
        const desc = await describeTable(table);
        const types: Record<string, string> = {};
        for (const c of desc) types[c.name.toLowerCase()] = c.type;
        const ref: TableRef = { view, table, cols: new Set(Object.keys(types)), types, seq: COL.sequence };
        if (kind === "feature" || kind === "psm") ref.seq = await detectSeqExpr(ref);
        out[kind] = ref;
      }
      return out;
    })();
    p.catch(() => tablesCache.delete(key));
    tablesCache.set(key, p);
  }
  return p;
}

/** Amino acids only from a ProForma peptidoform: drops [mods], {labile}, (…) and '-'. */
export function strippedPeptidoform(col = COL.peptidoform): string {
  return `regexp_replace(${col}, '\\[[^\\]]*\\]|\\{[^}]*\\}|\\([^)]*\\)|[^A-Z]', '', 'g')`;
}

// Some converted datasets put modification names into `sequence`
// (e.g. "HCCARBAMIDOMETHYLS…"). Sample a few rows; if `sequence` disagrees with
// the stripped peptidoform, derive the plain sequence from the peptidoform.
async function detectSeqExpr(ref: TableRef): Promise<string> {
  if (!ref.cols.has(COL.sequence)) return ref.cols.has(COL.peptidoform) ? strippedPeptidoform() : "NULL";
  if (!ref.cols.has(COL.peptidoform)) return COL.sequence;
  const r = await runSql(
    `SELECT count(*) FILTER (WHERE ${COL.sequence} <> ${strippedPeptidoform()}) AS bad
     FROM (SELECT ${COL.sequence}, ${COL.peptidoform} FROM ${ident(ref.table)} LIMIT 2000)`
  );
  return Number(r.rows[0][0]) > 0 ? strippedPeptidoform() : COL.sequence;
}

/** Query result rows as plain objects keyed by column name. */
export function objects(r: QueryResult): Record<string, any>[] {
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
}

/** Run (and memoise per dataset) a report query, so switching tabs is instant. */
export function cachedSql(ds: DatasetInfo, key: string, sql: string, maxRows = 100000): Promise<QueryResult> {
  const k = `${dsKey(ds)}::${key}::${sql}`;
  let p = sqlCache.get(k);
  if (!p) {
    p = runSql(sql, maxRows);
    p.catch(() => sqlCache.delete(k));
    sqlCache.set(k, p);
  }
  return p;
}

export function clearReportCache() {
  tablesCache.clear();
  sqlCache.clear();
  spectraCache.clear();
  scaleCache.clear();
}

/** Peptide-level evidence table: features if present, PSMs otherwise. */
export function evidence(t: DatasetTables): TableRef | undefined {
  return t.feature ?? t.psm;
}

const spectraCache = new Map<string, Promise<boolean>>();

/** Does the psm view carry fragment spectra (non-null `mz_array`)? Answered
 * from the parquet footer statistics, so no column data is read. */
export function hasSpectra(ref: TableRef | undefined): Promise<boolean> {
  if (!ref || !ref.cols.has(COL.mz_array) || !ref.cols.has(COL.intensity_array)) return Promise.resolve(false);
  const key = ref.view.path;
  let p = spectraCache.get(key);
  if (!p) {
    p = (async () => {
      const stats = await runSql(
        `SELECT sum(num_values)::BIGINT, sum(coalesce(stats_null_count, 0))::BIGINT, count(stats_null_count)::BIGINT, count(*)::BIGINT
         FROM parquet_metadata(${lit(`${ref.table}.parquet`)}) WHERE path_in_schema LIKE 'mz_array%'`
      );
      const [vals, nulls, withStats, chunks] = stats.rows[0].map(Number);
      if (chunks > 0 && withStats === chunks) return vals > nulls;
      // Some writers leave out null counts: look for one spectrum instead.
      const r = await runSql(`SELECT 1 FROM ${ident(ref.table)} WHERE len(${COL.mz_array}) > 0 LIMIT 1`, 1);
      return r.rows.length > 0;
    })();
    p.catch(() => spectraCache.delete(key));
    spectraCache.set(key, p);
  }
  return p;
}

/** Streamed views at least this big (compressed) are "large": reports avoid
 * whole-file scans until the user asks for something specific. */
export const LARGE_STREAM_BYTES = 1024 ** 3;

export interface ViewScale {
  /** Read over the network (S3 or HTTPS) rather than from a local file. */
  remote: boolean;
  rows: number;
  bytes: number;
  /** Remote and big enough that a full scan costs a large download. */
  large: boolean;
  /** Leading sort columns from the QPX footer (`qpx.sort_order`), if any. */
  sortedBy: string[];
  /** Compressed bytes per top-level column, from the footer. */
  colBytes: Record<string, number>;
}

const scaleCache = new Map<string, Promise<ViewScale>>();

/** Size, row count and sort order of a view, from the parquet footer only. */
export function viewScale(ref: Pick<TableRef, "view" | "table">): Promise<ViewScale> {
  const key = ref.view.path;
  let p = scaleCache.get(key);
  if (!p) {
    p = (async () => {
      const remote = /^(s3|https?):\/\//.test(ref.view.path);
      const file = lit(`${ref.table}.parquet`);
      const r = await runSql(`SELECT sum(num_rows)::BIGINT FROM parquet_file_metadata(${file})`, 1);
      const rows = Number(r.rows[0][0]);
      const b = await runSql(
        `SELECT lower(split_part(path_in_schema, ', ', 1)) AS c, sum(total_compressed_size)::BIGINT
         FROM parquet_metadata(${file}) GROUP BY 1`,
        10000
      );
      const colBytes: Record<string, number> = {};
      let total = 0;
      for (const [c, n] of b.rows) {
        colBytes[String(c)] = Number(n);
        total += Number(n);
      }
      const bytes = Math.max(ref.view.sizeBytes ?? 0, total);
      const kv = await runSql(
        `SELECT decode(value) FROM parquet_kv_metadata(${file}) WHERE decode(key) = ${lit(SORT_ORDER_KEY)} LIMIT 1`,
        1
      );
      const order = kv.rows[0]?.[0];
      const sortedBy = order == null ? [] : parseSortOrder(String(order));
      return { remote, rows, bytes, large: remote && bytes >= LARGE_STREAM_BYTES, sortedBy, colBytes };
    })();
    p.catch(() => scaleCache.delete(key));
    scaleCache.set(key, p);
  }
  return p;
}

/** Compressed bytes a full scan of these columns reads (unknown columns count 0). */
export function scanBytes(scale: ViewScale, cols: Iterable<string>): number {
  let n = 0;
  for (const c of new Set([...cols].map((x) => x.toLowerCase()))) n += scale.colBytes[c] ?? 0;
  return n;
}

/** The large streamed views among these, with their scale (footer reads only). */
export async function largeViews(refs: (TableRef | undefined)[]): Promise<{ ref: TableRef; scale: ViewScale }[]> {
  const out: { ref: TableRef; scale: ViewScale }[] = [];
  for (const ref of refs) {
    if (!ref || !/^(s3|https?):\/\//.test(ref.view.path)) continue;
    const scale = await viewScale(ref);
    if (scale.large) out.push({ ref, scale });
  }
  return out;
}

/** Column names from a `qpx.sort_order` value, which QPX relayout writes as
 * the comma-separated sort columns. */
export function parseSortOrder(v: string): string[] {
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

/** WHERE clause keeping target (non-decoy) rows only. */
export function targetWhere(ref: TableRef): string {
  return ref.cols.has(COL.is_decoy) ? `NOT coalesce(${COL.is_decoy}, false)` : "TRUE";
}

function isStructList(ref: TableRef, col: string): boolean {
  return /struct/i.test(ref.types[col] ?? "");
}

/** Expression giving one protein (group) identifier per evidence row. */
export function proteinExpr(ref: TableRef): string | null {
  if (ref.cols.has(COL.anchor_protein)) return COL.anchor_protein;
  if (ref.cols.has(COL.protein_accessions)) return `${COL.protein_accessions}[1]`;
  if (ref.cols.has(COL.pg_accessions)) return isStructList(ref, COL.pg_accessions) ? `${COL.pg_accessions}[1].accession` : `${COL.pg_accessions}[1]`;
  return null;
}

/** Accession list (VARCHAR[]) expression for the row, whatever the schema. */
function accessionListExpr(ref: TableRef): string | null {
  if (ref.cols.has(COL.pg_accessions)) {
    return isStructList(ref, COL.pg_accessions) ? `list_transform(${COL.pg_accessions}, x -> x.accession)` : COL.pg_accessions;
  }
  if (ref.cols.has(COL.protein_accessions)) return COL.protein_accessions;
  return null;
}

/** Rows that belong to protein `acc` (anchor protein or any group member). */
export function proteinMatchWhere(ref: TableRef, acc: string): string {
  const parts: string[] = [];
  if (ref.cols.has(COL.anchor_protein)) parts.push(`${COL.anchor_protein} = ${lit(acc)}`);
  const l = accessionListExpr(ref);
  if (l) parts.push(`list_contains(${l}, ${lit(acc)})`);
  return parts.length ? `(${parts.join(" OR ")})` : "FALSE";
}

/** Free-text protein search over accessions, protein names and gene names. */
export function proteinTextWhere(ref: TableRef, q: string): string {
  const query = q.trim();
  if (!query) return "TRUE";
  const pat = likePattern(query);
  const parts: string[] = [];
  if (ref.cols.has(COL.anchor_protein)) parts.push(`${COL.anchor_protein} ILIKE ${pat}`);
  const l = accessionListExpr(ref);
  if (l) parts.push(`array_to_string(${l}, ' ') ILIKE ${pat}`);
  for (const c of [COL.pg_names, COL.gg_names, COL.gg_accessions]) {
    if (ref.cols.has(c) && /\[\]|list/i.test(ref.types[c] ?? "")) parts.push(`array_to_string(${c}, ' ') ILIKE ${pat}`);
  }
  return parts.length ? `(${parts.join(" OR ")})` : "FALSE";
}

/** SQL string literal. */
export function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** SQL quoted identifier. */
export function ident(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** Contains-pattern literal for ILIKE (escapes %, _ and \). */
export function likePattern(s: string): string {
  const esc = s.replace(/[\\%_]/g, (m) => `\\${m}`);
  return `${lit(`%${esc}%`)} ESCAPE '\\'`;
}

/** Summed reporter/label intensity per row (works for LFQ and TMT). */
export function intensitySumExpr(ref: TableRef): string | null {
  if (!ref.cols.has(COL.intensities)) return null;
  return `list_sum(list_transform(${COL.intensities}, x -> x.intensity))`;
}

export function log10Expr(expr: string): string {
  return `CASE WHEN (${expr}) > 0 THEN log10(${expr}) END`;
}

/** Equal-width histogram over the central 99% of values. With `robust`, the
 * range is further limited to the Tukey fence (quartiles ± 3 IQR), so a few
 * extreme values (e.g. isotope-error matches at 500 ppm) cannot flatten it. */
export function histogramSql(table: string, expr: string, where: string, bins = 40, robust = false): string {
  const range = robust
    ? `SELECT greatest(p_lo, q1 - 3 * (q3 - q1)) AS lo, least(p_hi, q3 + 3 * (q3 - q1)) AS hi FROM (
         SELECT quantile_cont(x, 0.005) AS p_lo, quantile_cont(x, 0.995) AS p_hi,
                quantile_cont(x, 0.25) AS q1, quantile_cont(x, 0.75) AS q3 FROM v WHERE isfinite(x))`
    : `SELECT quantile_cont(x, 0.005) AS lo, quantile_cont(x, 0.995) AS hi FROM v WHERE isfinite(x)`;
  return `
WITH v AS MATERIALIZED (SELECT (${expr})::DOUBLE AS x FROM ${ident(table)} WHERE ${where}),
b AS (${range})
SELECT bin, count(*)::BIGINT AS n, any_value(lo) AS lo, any_value(hi) AS hi FROM (
  SELECT least(${bins - 1}, greatest(0, floor((x - lo) / nullif((hi - lo) / ${bins}, 0))))::INT AS bin, lo, hi
  FROM v, b WHERE isfinite(x) AND x BETWEEN lo AND hi
) GROUP BY bin ORDER BY bin`;
}

/** Turn histogram bounds into bin-start labels, counts and tooltip intervals. */
export function histogramData(r: QueryResult, bins = 40, integer = false): { labels: string[]; values: number[]; ranges: string[] } {
  if (!r.rows.length) return { labels: [], values: [], ranges: [] };
  const lo = Number(r.rows[0][2]);
  const hi = Number(r.rows[0][3]);
  if (lo === hi) bins = 1;
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const row of r.rows) {
    const b = Number(row[0]);
    if (b >= 0 && b < bins) counts[b] = Number(row[1]);
  }
  const fmt = (x: number) => Number.isInteger(x) ? scalarText(x) : fmtNum(x);
  const labels = counts.map((_, i) => fmt(lo + i * w));
  // Integer bins hold whole numbers, so the last one ends one below `hi`.
  const last = integer ? hi - 1 : hi;
  const ranges = counts.map((_, i) => `[${fmt(lo + i * w)}, ${fmt(i === bins - 1 ? last : lo + (i + 1) * w)}${i === bins - 1 ? "]" : ")"}`);
  return { labels, values: counts, ranges };
}


/** SQL pieces that map a run (`x.r`) and channel label (`x.i.label`) to a
 * sample through the run view: by (run, label) for multiplexed data, by run
 * alone when the run holds a single sample (label-free labels rarely match).
 * `ctes` continues a `WITH x AS (…)`, `joins` follows `FROM x`, and `col`
 * names the sample, falling back to the run (and channel). The joins are
 * aliased `m` (run, label) and `m1` (single-sample run). */
export function sampleMapSql(run: TableRef | undefined): { ctes: string; joins: string; col: string; mapped: boolean } {
  const R = run?.cols.has(COL.samples) ? run : undefined;
  // Channel names differ between converters ("TMT131" vs "TMT131N", case, spaces).
  const norm = (e: string) => `regexp_replace(upper(replace(${e}, ' ', '')), '^TMT131N$', 'TMT131')`;
  const fallback = `CASE WHEN x.i.label IS NULL OR x.i.label IN ('LFQ', 'label free sample') THEN x.r ELSE x.r || ' · ' || x.i.label END`;
  if (!R) return { ctes: "", joins: "", col: fallback, mapped: false };
  return {
    ctes: `, m AS (SELECT ${COL.run_file_name} AS r, ${norm("s.label")} AS l, min(s.sample_accession) AS sa
              FROM (SELECT ${COL.run_file_name}, unnest(${COL.samples}) AS s FROM ${ident(R.table)}) GROUP BY 1, 2),
         m1 AS (SELECT r, min(sa) AS sa FROM m GROUP BY r HAVING count(DISTINCT sa) = 1)`,
    joins: `LEFT JOIN m ON m.r = x.r AND m.l = ${norm("x.i.label")} LEFT JOIN m1 ON m1.r = x.r`,
    col: `coalesce(m.sa, m1.sa, ${fallback})`,
    mapped: true,
  };
}

/** Column definition for ReportTable. */
export interface Column {
  key: string;
  label: string;
  num?: boolean;
  /** Custom text formatter (ignored when a `cell-<key>` slot is provided). */
  fmt?: (v: any, row: any) => string;
  title?: string;
}
