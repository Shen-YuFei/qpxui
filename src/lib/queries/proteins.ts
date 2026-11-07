// The Proteins tab: protein (group) search over the pg view or, without one,
// the evidence view's protein column; and one protein's peptidoforms and
// per-run evidence.
import type { ChartSpec } from "../charts";
import { runSql } from "../duck";
import { ident, intensitySumExpr, lit, objects, proteinMatchWhere, proteinTextWhere, targetWhere, type TableRef } from "../report";
import { COL } from "../qpx";

/** Rows a search lists; one more is read to tell that there are more. */
export const PROTEIN_LIMIT = 500;

function pgSql(P: TableRef, where: string): string {
  const T = ident(P.table);
  const has = (c: string) => P.cols.has(c);
  const isum = intensitySumExpr(P);
  const sel = [
    `${COL.anchor_protein} AS protein`,
    has(COL.pg_accessions) ? `any_value(${COL.pg_accessions}) AS accessions` : null,
    has(COL.pg_names) ? `any_value(${COL.pg_names}) AS names` : null,
    has(COL.gg_names) ? `any_value(${COL.gg_names}) AS genes` : null,
    has(COL.run_file_name) ? `count(DISTINCT ${COL.run_file_name})::BIGINT AS runs` : null,
    has(COL.peptide_counts) ? `max(${COL.peptide_counts}.total_sequences)::BIGINT AS peptides` : null,
    has(COL.peptide_counts) ? `max(${COL.peptide_counts}.unique_sequences)::BIGINT AS unique_peptides` : null,
    has(COL.global_qvalue) ? `min(${COL.global_qvalue}) AS qvalue` : has(COL.pg_qvalue) ? `min(${COL.pg_qvalue}) AS qvalue` : null,
    has(COL.sequence_coverage) ? `max(${COL.sequence_coverage}) AS coverage` : null,
    isum ? `avg(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS log_int` : null,
  ].filter(Boolean);
  return `SELECT ${sel.join(", ")} FROM ${T}
WHERE ${targetWhere(P)} AND ${COL.anchor_protein} IS NOT NULL AND ${where}
GROUP BY ${COL.anchor_protein} ORDER BY ${has(COL.run_file_name) ? "runs DESC, " : ""}${has(COL.peptide_counts) ? "peptides DESC, " : ""}protein
LIMIT ${PROTEIN_LIMIT + 1}`;
}

function evSql(E: TableRef, prot: string, where: string): string {
  const T = ident(E.table);
  const isum = intensitySumExpr(E);
  const sel = [
    `${prot} AS protein`,
    E.cols.has(COL.gg_names) ? `any_value(${COL.gg_names}) AS genes` : null,
    E.cols.has(COL.run_file_name) ? `count(DISTINCT ${COL.run_file_name})::BIGINT AS runs` : null,
    E.seq !== "NULL" ? `count(DISTINCT ${E.seq})::BIGINT AS peptides` : null,
    "count(*)::BIGINT AS n_ev",
    isum ? `avg(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS log_int` : null,
  ].filter(Boolean);
  return `SELECT ${sel.join(", ")} FROM ${T}
WHERE ${targetWhere(E)} AND ${prot} IS NOT NULL AND ${where}
GROUP BY 1 ORDER BY ${E.seq !== "NULL" ? "peptides DESC, " : ""}n_ev DESC LIMIT ${PROTEIN_LIMIT + 1}`;
}

/** Protein groups (pg view) or proteins (`prot` of the evidence view `ev`)
 * matching the search text, the first PROTEIN_LIMIT of them. */
export async function searchProteins(
  pg: TableRef | undefined,
  ev: TableRef | undefined,
  prot: string | null,
  q: string
): Promise<{ rows: Record<string, any>[]; truncated: boolean }> {
  const sql = pg ? pgSql(pg, proteinTextWhere(pg, q)) : evSql(ev!, prot!, proteinTextWhere(ev!, q));
  const out = objects(await runSql(sql, PROTEIN_LIMIT + 1));
  return { rows: out.slice(0, PROTEIN_LIMIT), truncated: out.length > PROTEIN_LIMIT };
}

/** The protein's target peptidoforms in the evidence view, with charges,
 * evidence rows, runs, best PEP, mean log10 intensity and uniqueness. */
export async function proteinPeptidoforms(ev: TableRef, acc: string): Promise<Record<string, any>[]> {
  const T = ident(ev.table);
  const W = `${targetWhere(ev)} AND ${proteinMatchWhere(ev, acc)}`;
  const isum = intensitySumExpr(ev);
  const has = (c: string) => ev.cols.has(c);
  const pf = has(COL.peptidoform) ? COL.peptidoform : ev.seq;
  const sel = [
    `${pf} AS peptidoform`,
    `any_value(${ev.seq}) AS sequence`,
    has(COL.modifications) ? `any_value(${COL.modifications}) AS modifications` : null,
    has(COL.charge) ? `list_sort(list_distinct(list(${COL.charge}))) AS charges` : null,
    "count(*)::BIGINT AS n_ev",
    has(COL.run_file_name) ? `count(DISTINCT ${COL.run_file_name})::BIGINT AS runs` : null,
    has(COL.posterior_error_probability) ? `min(${COL.posterior_error_probability}) AS best_pep` : null,
    isum ? `avg(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS log_int` : null,
    has(COL.unique) ? `bool_or("${COL.unique}") AS "unique"` : null,
  ].filter(Boolean);
  const r = await runSql(`SELECT ${sel.join(", ")} FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY n_ev DESC LIMIT 2000`, 2000);
  return objects(r);
}

/** The protein's evidence rows and peptides in each run, as a bar chart;
 * null when the evidence view has no runs. */
export async function proteinRunsChart(ev: TableRef, acc: string, evName: string): Promise<ChartSpec | null> {
  if (!ev.cols.has(COL.run_file_name)) return null;
  const T = ident(ev.table);
  const W = `${targetWhere(ev)} AND ${proteinMatchWhere(ev, acc)}`;
  const isum = intensitySumExpr(ev);
  const rr = await runSql(
    `SELECT ${COL.run_file_name}, count(*)::BIGINT AS n${ev.seq !== "NULL" ? `, count(DISTINCT ${ev.seq})::BIGINT AS p` : ""}
           ${isum ? `, median(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS li` : ""}
           FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY 1`
  );
  const o = objects(rr).sort((a, b) => String(a.run_file_name).localeCompare(String(b.run_file_name), undefined, { numeric: true }));
  return {
    kind: "bar",
    labels: o.map((x) => String(x.run_file_name)),
    series: [
      { name: evName, values: o.map((x) => x.n) },
      ...(ev.seq !== "NULL" ? [{ name: "peptides", values: o.map((x) => x.p) }] : []),
    ],
    notes: isum ? o.map((x) => (x.li == null ? "" : `median log10 intensity ${Number(x.li).toFixed(2)}`)) : undefined,
    xName: "run",
    hideLabels: o.length > 30,
  };
}

/** The protein group's row in each run (pg view): peptides, unique
 * peptides, features, q-value and log10 intensity. */
export async function proteinGroupRuns(pg: TableRef, acc: string): Promise<Record<string, any>[]> {
  const isum = intensitySumExpr(pg);
  const has = (c: string) => pg.cols.has(c);
  const sel = [
    COL.run_file_name,
    has(COL.peptide_counts) ? `${COL.peptide_counts}.total_sequences AS peptides` : null,
    has(COL.peptide_counts) ? `${COL.peptide_counts}.unique_sequences AS unique_peptides` : null,
    has(COL.feature_counts) ? `${COL.feature_counts}.total_features AS features` : null,
    has(COL.pg_qvalue) ? `${COL.pg_qvalue} AS qvalue` : has(COL.global_qvalue) ? `${COL.global_qvalue} AS qvalue` : null,
    isum ? `CASE WHEN ${isum} > 0 THEN log10(${isum}) END AS log_int` : null,
  ].filter(Boolean);
  const r = await runSql(
    `SELECT ${sel.join(", ")} FROM ${ident(pg.table)} WHERE ${targetWhere(pg)} AND ${COL.anchor_protein} = ${lit(acc)} ORDER BY ${COL.run_file_name}`
  );
  return objects(r);
}

/** The protein group's accessions, names and genes (pg view). */
export async function proteinGroupNames(pg: TableRef, acc: string): Promise<Record<string, any> | undefined> {
  const has = (c: string) => pg.cols.has(c);
  const meta = await runSql(
    `SELECT any_value(${COL.pg_accessions}) AS accessions${has(COL.pg_names) ? `, any_value(${COL.pg_names}) AS names` : ""}${has(COL.gg_names) ? `, any_value(${COL.gg_names}) AS genes` : ""}
           FROM ${ident(pg.table)} WHERE ${COL.anchor_protein} = ${lit(acc)}`
  );
  return objects(meta)[0];
}
