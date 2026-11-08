// The Overview tab: whole-dataset distributions of the evidence view
// (features, or PSMs), one query per chart.
import type { DatasetInfo } from "../api";
import type { ChartSpec } from "../charts";
import {
  cachedSql,
  histogramData,
  histogramSql,
  ident,
  intensitySumExpr,
  log10Expr,
  proteinExpr,
  targetWhere,
  type TableRef,
} from "../report";
import { COL } from "../qpx";

export const OVERVIEW_CHARTS = ["perRun", "charge", "length", "mc", "ppg", "ppm", "rt", "intensity", "pep", "qvalue"] as const;
export type OverviewChart = (typeof OVERVIEW_CHARTS)[number];

/** Evidence-view columns the charts read (for the large-view gate). */
export const OVERVIEW_COLUMNS = [COL.is_decoy, COL.run_file_name, COL.charge, COL.sequence, COL.peptidoform, COL.missed_cleavages, COL.anchor_protein,
  COL.protein_accessions, COL.pg_accessions, COL.mass_error_ppm, COL.rt, COL.intensities, COL.posterior_error_probability, COL.peptide_qvalue];

/** A loader per chart the evidence view `ev` has the columns for; `evName`
 * names its rows ("features" or "PSMs"). */
export function overviewCharts(
  ds: DatasetInfo,
  ev: TableRef,
  evName: string
): Partial<Record<OverviewChart, () => Promise<ChartSpec | null>>> {
  const T = ident(ev.table);
  const W = targetWhere(ev);
  const has = (c: string) => ev.cols.has(c);
  const prot = proteinExpr(ev);
  const isum = intensitySumExpr(ev);

  async function counts(key: string, sql: string, xName: string, yName = evName): Promise<ChartSpec> {
    const r = await cachedSql(ds, key, sql);
    return {
      kind: "bar",
      labels: r.rows.map((x) => String(x[0] ?? "∅")),
      series: [{ name: yName, values: r.rows.map((x) => Number(x[1])) }],
      xName,
    };
  }

  async function hist(key: string, expr: string, where: string, xName: string, yName = evName, robust = false): Promise<ChartSpec | null> {
    const r = await cachedSql(ds, key, histogramSql(ev.table, expr, where, 40, robust));
    const h = histogramData(r);
    return { kind: "bar", labels: h.labels, series: [{ name: yName, values: h.values }], notes: h.ranges.map((range) => `Range: ${range}`), xName };
  }

  return {
    perRun: has(COL.run_file_name)
      ? async () => {
          const r = await cachedSql(
            ds,
            "ov.perRun",
            `SELECT ${COL.run_file_name}, count(*) AS n FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`
          );
          return {
            kind: "line",
            labels: r.rows.map((x) => String(x[0] ?? "∅")),
            series: [{ name: evName, values: r.rows.map((x) => Number(x[1])) }],
            xName: `runs (${r.rows.length}), most first`,
            hideLabels: r.rows.length > 30,
            zeroBased: true,
          };
        }
      : undefined,
    charge: has(COL.charge)
      ? () => counts("ov.charge", `SELECT ${COL.charge}, count(*) FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY 1`, "charge")
      : undefined,
    length: ev.seq !== "NULL"
      ? () =>
          counts(
            "ov.length",
            `SELECT length(${ev.seq}) AS len, count(*) FROM ${T} WHERE ${W} AND ${ev.seq} IS NOT NULL GROUP BY 1 ORDER BY 1`,
            "residues"
          )
      : undefined,
    mc: has(COL.missed_cleavages)
      ? () => counts("ov.mc", `SELECT ${COL.missed_cleavages}, count(*) FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY 1`, "missed cleavages")
      : undefined,
    ppg: prot && ev.seq !== "NULL"
      ? async () => {
          const s = await counts(
            "ov.ppg",
            `SELECT least(n, 20) AS k, count(*) FROM (
               SELECT ${prot} AS p, count(DISTINCT ${ev.seq}) AS n FROM ${T}
               WHERE ${W} AND ${prot} IS NOT NULL GROUP BY 1
             ) GROUP BY 1 ORDER BY 1`,
            "peptides (20 = 20 or more)",
            "protein groups"
          );
          s.labels = s.labels.map((l) => (l === "20" ? "20+" : l));
          return s;
        }
      : undefined,
    ppm: has(COL.mass_error_ppm) ? () => hist("ov.ppm", COL.mass_error_ppm, W, "ppm", evName, true) : undefined,
    rt: has(COL.rt) ? () => hist("ov.rt", `${COL.rt} / 60.0`, W, "minutes") : undefined,
    intensity: isum ? () => hist("ov.int", log10Expr(isum), W, "log10 intensity") : undefined,
    pep: has(COL.posterior_error_probability)
      ? () => hist("ov.pep", log10Expr(COL.posterior_error_probability), W, "log10 PEP", evName)
      : undefined,
    qvalue: has(COL.peptide_qvalue)
      ? () => hist("ov.q", COL.peptide_qvalue, W, "peptide q-value", evName)
      : undefined,
  };
}
