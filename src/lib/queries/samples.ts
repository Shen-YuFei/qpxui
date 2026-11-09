// The Samples tab: the sample view (with the runs and channels each sample
// was measured in), its attribute counts, or the run view when there is no
// sample view.
import type { DatasetInfo } from "../api";
import type { ChartSpec } from "../charts";
import { cachedSql, ident, objects, type TableRef } from "../report";
import { COL } from "../qpx";

/** Sample rows, with runs and labels from the run view when it maps them. */
export async function sampleRows(ds: DatasetInfo, sample: TableRef, runV: TableRef | undefined): Promise<Record<string, any>[]> {
  // Attach how many runs / which channels each sample was measured in.
  const hasMap = !!runV?.cols.has(COL.samples);
  const sql = hasMap
    ? `WITH m AS (
             SELECT s.sample_accession AS sample_accession, count(DISTINCT ${COL.run_file_name})::BIGINT AS runs,
                    string_agg(DISTINCT s.label, ', ') AS labels
             FROM (SELECT ${COL.run_file_name}, unnest(${COL.samples}) AS s FROM ${ident(runV!.table)}) GROUP BY 1)
           SELECT x.*, m.runs, m.labels FROM ${ident(sample.table)} x LEFT JOIN m USING (${COL.sample_accession})`
    : `SELECT * FROM ${ident(sample.table)}`;
  const r = await cachedSql(ds, "smp.rows", sql, 50000);
  return objects(r).sort((a, b) =>
    String(a.sample_accession ?? "").localeCompare(String(b.sample_accession ?? ""), undefined, { numeric: true })
  );
}

/** Samples per value of one attribute (top 25); null when every sample has
 * the same value (the header and table show it already). */
export async function sampleFacet(ds: DatasetInfo, sample: TableRef, col: string): Promise<ChartSpec | null> {
  const f = await cachedSql(
    ds,
    `smp.f.${col}`,
    `SELECT coalesce(${ident(col)}, 'not available') AS k, count(*)::BIGINT AS n FROM ${ident(sample.table)} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`
  );
  if (f.rows.length < 2) return null;
  return {
    kind: "hbar",
    labels: f.rows.map((x) => String(x[0])),
    series: [{ name: "samples", values: f.rows.map((x) => Number(x[1])) }],
    xName: "samples",
  };
}

/** The run view's rows, without its (optional) modification parameters. */
export async function runRows(ds: DatasetInfo, runV: TableRef): Promise<Record<string, any>[]> {
  // modification_parameters is optional in the QPX run view.
  const cols = runV.cols.has(COL.modification_parameters) ? `* EXCLUDE (${COL.modification_parameters})` : "*";
  const r = await cachedSql(ds, "smp.runs", `SELECT ${cols} FROM ${ident(runV.table)}`, 50000);
  return objects(r);
}
