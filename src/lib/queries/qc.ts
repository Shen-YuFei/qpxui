// The QC tab: per-run metrics of the evidence view (joined with the psm, pg
// and run views) and the intensity distribution of each sample.
import type { DatasetInfo } from "../api";
import type { ChartSpec } from "../charts";
import { cachedSql, ident, intensitySumExpr, objects, proteinExpr, targetWhere, type DatasetTables, type TableRef } from "../report";

/** Evidence-view columns the tab reads (for the large-view gate). */
export const QC_EVIDENCE_COLUMNS = ["is_decoy", "run_file_name", "sequence", "peptidoform", "anchor_protein", "protein_accessions",
  "pg_accessions", "intensities", "mass_error_ppm", "rt", "charge", "missed_cleavages"];
/** Columns read from the psm (beside features) and pg views. */
export const QC_COUNT_COLUMNS = ["is_decoy", "run_file_name"];

/** Per-run metrics: one row per run of the evidence view `ev`, with the
 * columns its views allow (see the QC table). */
export async function runMetrics(
  ds: DatasetInfo,
  t: DatasetTables,
  ev: TableRef
): Promise<{ rows: Record<string, any>[]; columns: string[] }> {
  const T = ident(ev.table);
  const W = targetWhere(ev);
  const prot = proteinExpr(ev);
  const isum = intensitySumExpr(ev);
  const sel = [
    "run_file_name",
    `count(*)::BIGINT AS n_ev`,
    ev.seq !== "NULL" ? `count(DISTINCT ${ev.seq})::BIGINT AS n_pep` : null,
    prot ? `count(DISTINCT ${prot})::BIGINT AS n_prot` : null,
    isum ? `median(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS med_int` : null,
    ev.cols.has("mass_error_ppm") ? "median(mass_error_ppm) AS med_ppm" : null,
    ev.cols.has("rt") ? "median(rt) / 60.0 AS med_rt" : null,
    ev.cols.has("charge") ? "avg(charge) AS avg_charge" : null,
    ev.cols.has("missed_cleavages") ? "avg((missed_cleavages > 0)::INT) * 100 AS pct_mc" : null,
  ].filter(Boolean);
  const parts: string[] = [`ev AS (SELECT ${sel.join(", ")} FROM ${T} WHERE ${W} GROUP BY 1)`];
  const joins: string[] = [];
  const extra: string[] = [];
  const psm = t.psm;
  if (t.feature && psm?.cols.has("run_file_name")) {
    parts.push(`ps AS (SELECT run_file_name, count(*)::BIGINT AS n_psm FROM ${ident(psm.table)} WHERE ${targetWhere(psm)} GROUP BY 1)`);
    joins.push("LEFT JOIN ps USING (run_file_name)");
    extra.push("ps.n_psm");
  }
  const pg = t.pg;
  if (pg?.cols.has("run_file_name")) {
    parts.push(`pgc AS (SELECT run_file_name, count(*)::BIGINT AS n_pg FROM ${ident(pg.table)} WHERE ${targetWhere(pg)} GROUP BY 1)`);
    joins.push("LEFT JOIN pgc USING (run_file_name)");
    extra.push("pgc.n_pg");
  }
  const rv = t.run;
  if (rv?.cols.has("run_file_name")) {
    const rsel = ["run_file_name"];
    if (rv.cols.has("instrument")) { rsel.push("instrument"); extra.push("r.instrument"); }
    if (rv.cols.has("fraction")) { rsel.push("fraction"); extra.push("r.fraction"); }
    if (rv.cols.has("samples")) { rsel.push("len(samples) AS n_samples"); extra.push("r.n_samples"); }
    parts.push(`r AS (SELECT ${rsel.join(", ")} FROM ${ident(rv.table)})`);
    joins.push("LEFT JOIN r USING (run_file_name)");
  }
  const sql = `WITH ${parts.join(",\n")}
SELECT ev.*${extra.length ? ", " + extra.join(", ") : ""} FROM ev ${joins.join(" ")} ORDER BY run_file_name`;
  const res = await cachedSql(ds, "qc.runs", sql);
  return { rows: objects(res), columns: res.columns };
}

/** log10 intensity distribution per sample (or per run × channel if unmapped). */
export async function sampleIntensities(ds: DatasetInfo, t: DatasetTables, ev: TableRef): Promise<ChartSpec | null> {
  if (!ev.cols.has("intensities") || !ev.cols.has("run_file_name")) return null;
  const rv = t.run;
  const mapped = !!rv?.cols.has("samples") && rv.cols.has("run_file_name");
  const sampleExpr = mapped ? "coalesce(m.sample_accession, i.run_file_name || ' · ' || i.label)" : "i.run_file_name || ' · ' || i.label";
  const sql = `
WITH i AS (
  SELECT run_file_name, u.label AS label, u.intensity AS intensity
  FROM (SELECT run_file_name, unnest(intensities) AS u FROM ${ident(ev.table)} WHERE ${targetWhere(ev)})
  WHERE u.intensity > 0
)${mapped ? `,
m AS (SELECT run_file_name, s.sample_accession AS sample_accession, s.label AS label
      FROM (SELECT run_file_name, unnest(samples) AS s FROM ${ident(rv!.table)}))` : ""}
SELECT ${sampleExpr} AS smp, count(*)::BIGINT AS n,
       quantile_cont(log10(i.intensity), [0.05, 0.25, 0.5, 0.75, 0.95]) AS q
FROM i ${mapped ? "LEFT JOIN m ON m.run_file_name = i.run_file_name AND m.label = i.label" : ""}
GROUP BY 1 ORDER BY 1 LIMIT 400`;
  const r = await cachedSql(ds, "qc.samples", sql);
  const rows = objects(r);
  // Natural sort so Sample-2 comes before Sample-10.
  rows.sort((a, b) => String(a.smp).localeCompare(String(b.smp), undefined, { numeric: true }));
  return {
    kind: "box",
    labels: rows.map((x) => String(x.smp)),
    series: [{ name: "log10 intensity", values: rows.map((x) => (x.q as number[]).map(Number)) }],
    xName: mapped ? "sample" : "run · channel",
    hideLabels: rows.length > 40,
  };
}
