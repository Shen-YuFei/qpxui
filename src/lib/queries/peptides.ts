// The Peptidoforms tab: peptidoform search over the evidence view and one
// peptidoform's per-run evidence (features, or PSMs when they carry spectra).
import type { DatasetInfo } from "../api";
import { runSql } from "../duck";
import { cachedSql, ident, intensitySumExpr, likePattern, lit, objects, targetWhere, type TableRef } from "../report";

/** Rows a search lists; one more is read to tell that there are more. */
export const PEPTIDOFORM_LIMIT = 500;

export interface PeptidoformFilter {
  /** Sequence text (non-letters dropped) or peptidoform text. */
  q: string;
  mode: "contains" | "exact" | "prefix";
  /** Modification name, "" for any. */
  mod: string;
  minCharge: number | null;
}

/** WHERE clause for target rows of `ev` matching the filter. */
export function peptidoformWhere(ev: TableRef, f: PeptidoformFilter): string {
  const parts = [targetWhere(ev)];
  // Strip anything that is not an amino-acid letter, so "pep tide" / lower case work.
  const s = f.q.trim().toUpperCase();
  if (s) {
    const aa = s.replace(/[^A-Z]/g, "");
    const seqCond =
      f.mode === "exact" ? `${ev.seq} = ${lit(aa)}`
      : f.mode === "prefix" ? `starts_with(${ev.seq}, ${lit(aa)})`
      : `contains(${ev.seq}, ${lit(aa)})`;
    // Also match peptidoform text (e.g. "M[Oxidation]" or "UNIMOD:21").
    const pfCond = ev.cols.has("peptidoform") && /[[\]:+]/.test(f.q) ? ` OR peptidoform ILIKE ${likePattern(f.q.trim())}` : "";
    parts.push(`(${aa ? seqCond : "FALSE"}${pfCond})`);
  }
  if (f.mod && ev.cols.has("modifications")) {
    parts.push(`list_contains(list_transform(modifications, x -> x.name), ${lit(f.mod)})`);
  }
  if (f.minCharge && ev.cols.has("charge")) parts.push(`charge >= ${Number(f.minCharge)}`);
  return parts.join(" AND ");
}

/** Peptidoforms matching the filter, most evidence rows first, with their
 * protein (`prot` of `ev`), genes, charges, runs, best PEP and mean log10
 * intensity; the first PEPTIDOFORM_LIMIT of them. */
export async function searchPeptidoforms(
  ev: TableRef,
  prot: string | null,
  f: PeptidoformFilter
): Promise<{ rows: Record<string, any>[]; truncated: boolean }> {
  const has = (c: string) => ev.cols.has(c);
  const isum = intensitySumExpr(ev);
  const pf = has("peptidoform") ? "peptidoform" : ev.seq;
  const sel = [
    `${pf} AS peptidoform`,
    `any_value(${ev.seq}) AS sequence`,
    has("modifications") ? "any_value(modifications) AS modifications" : null,
    prot ? `any_value(${prot}) AS protein` : null,
    has("gg_names") ? "any_value(gg_names) AS genes" : null,
    has("charge") ? "list_sort(list_distinct(list(charge))) AS charges" : null,
    "count(*)::BIGINT AS n_ev",
    has("run_file_name") ? "count(DISTINCT run_file_name)::BIGINT AS runs" : null,
    has("posterior_error_probability") ? "min(posterior_error_probability) AS best_pep" : null,
    isum ? `avg(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS log_int` : null,
  ].filter(Boolean);
  const r = await runSql(
    `SELECT ${sel.join(", ")} FROM ${ident(ev.table)} WHERE ${peptidoformWhere(ev, f)}
       GROUP BY 1 ORDER BY n_ev DESC, peptidoform LIMIT ${PEPTIDOFORM_LIMIT + 1}`,
    PEPTIDOFORM_LIMIT + 1
  );
  const out = objects(r);
  return { rows: out.slice(0, PEPTIDOFORM_LIMIT), truncated: out.length > PEPTIDOFORM_LIMIT };
}

/** The peptidoform's target rows in `E` (run, scan, charge, RT, m/z, ppm,
 * PEP, log10 intensity), by run and PEP; at most 5000. */
export async function peptidoformEvidence(E: TableRef, peptidoform: string): Promise<Record<string, any>[]> {
  const has = (c: string) => E.cols.has(c);
  const isum = intensitySumExpr(E);
  const pfCol = has("peptidoform") ? "peptidoform" : E.seq;
  const scanList = /\[\]|list/i.test(E.types.scan ?? "");
  const sel = [
    has("run_file_name") ? "run_file_name" : null,
    has("scan") ? (scanList ? "scan[1] AS scan_no" : "scan AS scan_no") : null,
    has("charge") ? "charge" : null,
    has("rt") ? "rt / 60.0 AS rt_min" : null,
    has("observed_mz") ? "observed_mz" : null,
    has("mass_error_ppm") ? "mass_error_ppm" : null,
    has("posterior_error_probability") ? "posterior_error_probability" : null,
    isum ? `CASE WHEN ${isum} > 0 THEN log10(${isum}) END AS log_int` : null,
  ].filter(Boolean);
  const r = await runSql(
    `SELECT ${sel.join(", ")} FROM ${ident(E.table)} WHERE ${targetWhere(E)} AND ${pfCol} = ${lit(peptidoform)}
       ORDER BY ${has("run_file_name") ? "run_file_name" : "1"}${has("posterior_error_probability") ? ", posterior_error_probability" : ""} LIMIT 5000`
  );
  return objects(r);
}

/** Names of the modifications in the target rows of `ev`, most rows first
 * (the modification filter). */
export async function modificationNames(ds: DatasetInfo, ev: TableRef): Promise<string[]> {
  const r = await cachedSql(
    ds,
    "ptm.mods",
    `SELECT m.name AS name, any_value(m.accession) AS accession,
              count(DISTINCT pf)::BIGINT AS n_pf, count(DISTINCT seq)::BIGINT AS n_pep, count(*)::BIGINT AS n_ev
       FROM (SELECT unnest(modifications) AS m, ${ev.cols.has("peptidoform") ? "peptidoform" : ev.seq} AS pf, ${ev.seq} AS seq
             FROM ${ident(ev.table)} WHERE ${targetWhere(ev)})
       GROUP BY 1 ORDER BY n_ev DESC`
  );
  return r.rows.map((x) => String(x[0])).filter((x) => x && x !== "null");
}
