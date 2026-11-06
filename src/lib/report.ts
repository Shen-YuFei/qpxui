// Dataset-level reports and search: resolves which QPX views a dataset has,
// and builds column-selective SQL so streamed (lazy) views only fetch the
// column chunks a chart actually needs.

import type { DatasetInfo, ViewInfo } from "./api";
import { describeTable, ensureViewReady, runSql, type QueryResult } from "./duck";

export type ViewKind = "feature" | "psm" | "pg" | "run" | "sample" | "dataset";

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

const KINDS: ViewKind[] = ["feature", "psm", "pg", "run", "sample", "dataset"];
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
      const out: DatasetTables = {};
      for (const kind of KINDS) {
        const view = ds.views.find((v) => v.view === kind && v.format === "parquet")
          ?? ds.views.find((v) => v.view === kind);
        if (!view || view.format !== "parquet") continue;
        const table = await ensureViewReady(view);
        const desc = await describeTable(table);
        const types: Record<string, string> = {};
        for (const c of desc) types[c.name.toLowerCase()] = c.type;
        const ref: TableRef = { view, table, cols: new Set(Object.keys(types)), types, seq: "sequence" };
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
export function strippedPeptidoform(col = "peptidoform"): string {
  return `regexp_replace(${col}, '\\[[^\\]]*\\]|\\{[^}]*\\}|\\([^)]*\\)|[^A-Z]', '', 'g')`;
}

// Some converted datasets put modification names into `sequence`
// (e.g. "HCCARBAMIDOMETHYLS…"). Sample a few rows; if `sequence` disagrees with
// the stripped peptidoform, derive the plain sequence from the peptidoform.
async function detectSeqExpr(ref: TableRef): Promise<string> {
  if (!ref.cols.has("sequence")) return ref.cols.has("peptidoform") ? strippedPeptidoform() : "NULL";
  if (!ref.cols.has("peptidoform")) return "sequence";
  try {
    const r = await runSql(
      `SELECT count(*) FILTER (WHERE sequence <> ${strippedPeptidoform()}) AS bad
       FROM (SELECT sequence, peptidoform FROM ${ident(ref.table)} LIMIT 2000)`
    );
    return Number(r.rows[0]?.[0] ?? 0) > 0 ? strippedPeptidoform() : "sequence";
  } catch {
    return "sequence";
  }
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
}

/** Peptide-level evidence table: features if present, PSMs otherwise. */
export function evidence(t: DatasetTables): TableRef | undefined {
  return t.feature ?? t.psm;
}

const spectraCache = new Map<string, Promise<boolean>>();

/** Does the psm view carry fragment spectra (non-null `mz_array`)? Answered
 * from the parquet footer statistics, so no column data is read. */
export function hasSpectra(ref: TableRef | undefined): Promise<boolean> {
  if (!ref || !ref.cols.has("mz_array") || !ref.cols.has("intensity_array")) return Promise.resolve(false);
  const key = ref.view.path;
  let p = spectraCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const r = await runSql(
          `SELECT sum(num_values)::BIGINT, sum(coalesce(stats_null_count, 0))::BIGINT, count(stats_null_count)::BIGINT, count(*)::BIGINT
           FROM parquet_metadata(${lit(`${ref.table}.parquet`)}) WHERE path_in_schema LIKE 'mz_array%'`
        );
        const [vals, nulls, withStats, chunks] = (r.rows[0] ?? []).map(Number);
        if (chunks > 0 && withStats === chunks) return vals > nulls;
      } catch {
        /* fall through to a data probe */
      }
      const r = await runSql(`SELECT 1 FROM ${ident(ref.table)} WHERE len(mz_array) > 0 LIMIT 1`, 1);
      return r.rows.length > 0;
    })();
    p.catch(() => spectraCache.delete(key));
    spectraCache.set(key, p);
  }
  return p;
}

/** WHERE clause keeping target (non-decoy) rows only. */
export function targetWhere(ref: TableRef): string {
  return ref.cols.has("is_decoy") ? "NOT coalesce(is_decoy, false)" : "TRUE";
}

function isStructList(ref: TableRef, col: string): boolean {
  return /struct/i.test(ref.types[col] ?? "");
}

/** Expression giving one protein (group) identifier per evidence row. */
export function proteinExpr(ref: TableRef): string | null {
  if (ref.cols.has("anchor_protein")) return "anchor_protein";
  if (ref.cols.has("protein_accessions")) return "protein_accessions[1]";
  if (ref.cols.has("pg_accessions")) return isStructList(ref, "pg_accessions") ? "pg_accessions[1].accession" : "pg_accessions[1]";
  return null;
}

/** Accession list (VARCHAR[]) expression for the row, whatever the schema. */
function accessionListExpr(ref: TableRef): string | null {
  if (ref.cols.has("pg_accessions")) {
    return isStructList(ref, "pg_accessions") ? "list_transform(pg_accessions, x -> x.accession)" : "pg_accessions";
  }
  if (ref.cols.has("protein_accessions")) return "protein_accessions";
  return null;
}

/** Rows that belong to protein `acc` (anchor protein or any group member). */
export function proteinMatchWhere(ref: TableRef, acc: string): string {
  const parts: string[] = [];
  if (ref.cols.has("anchor_protein")) parts.push(`anchor_protein = ${lit(acc)}`);
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
  if (ref.cols.has("anchor_protein")) parts.push(`anchor_protein ILIKE ${pat}`);
  const l = accessionListExpr(ref);
  if (l) parts.push(`array_to_string(${l}, ' ') ILIKE ${pat}`);
  for (const c of ["pg_names", "gg_names", "gg_accessions"]) {
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
  if (!ref.cols.has("intensities")) return null;
  return "list_sum(list_transform(intensities, x -> x.intensity))";
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

/** Turn a histogramSql result into bin-centre labels and counts. */
export function histogramData(r: QueryResult, bins = 40): { labels: string[]; values: number[] } {
  if (!r.rows.length) return { labels: [], values: [] };
  const lo = Number(r.rows[0][2]);
  const hi = Number(r.rows[0][3]);
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const row of r.rows) {
    const b = Number(row[0]);
    if (b >= 0 && b < bins) counts[b] = Number(row[1]);
  }
  const labels = counts.map((_, i) => fmtNum(lo + (i + 0.5) * w));
  return { labels, values: counts };
}

export function fmtNum(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a === 0) return "0";
  if (a >= 1000) return x.toFixed(0);
  if (a >= 10) return x.toFixed(1);
  if (a >= 1) return x.toFixed(2);
  return x.toPrecision(2);
}

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return Math.round(n).toLocaleString();
}

export function fmtShort(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Join the first element of a VARCHAR[] (or a scalar) for display. */
export function listText(v: unknown, max = 3): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) {
    const items = v.filter((x) => x !== null && x !== undefined).map(String);
    return items.length > max ? `${items.slice(0, max).join(", ")} +${items.length - max}` : items.join(", ");
  }
  return String(v);
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
