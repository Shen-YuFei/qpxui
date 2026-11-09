// The spectrum viewer: one PSM's identification and peaks from the psm view,
// the other PSMs of its peptidoform, and one of those PSMs' peaks.
import { runSql } from "../duck";
import { ident, lit, objects, type TableRef } from "../report";
import { COL } from "../qpx";

/** A PSM of the psm view, as the tables that open the viewer know it. */
export interface PsmKey {
  peptidoform: string;
  run_file_name?: string | null;
  scan?: number | null;
  charge?: number | null;
}

/** Columns of the PSM row the viewer reads (those the view has). */
const SPECTRUM_COLUMNS = [COL.peptidoform, COL.charge, COL.run_file_name, COL.scan, COL.calculated_mz, COL.observed_mz, COL.posterior_error_probability,
  COL.rt, COL.cv_params, COL.mz_array, COL.intensity_array, COL.charge_array, COL.ion_type_array];

// A result row's value of a column, matched case-insensitively.
function rowValue(columns: string[], row: unknown[] | undefined, col: string): unknown {
  const j = columns.findIndex((c) => c.toLowerCase() === col);
  return j >= 0 ? row?.[j] : undefined;
}

/** Why a psm-view result row cannot open the spectrum viewer, or "" when it
 * can; `peaksRead` when the row's peak arrays were read. */
export function whyNoSpectrum(columns: string[], row: unknown[] | undefined, peaksRead: boolean): string {
  const pf = rowValue(columns, row, COL.peptidoform);
  if (typeof pf !== "string" || !pf) return "This PSM has no peptidoform";
  if (peaksRead) {
    const mz = rowValue(columns, row, COL.mz_array);
    if (!Array.isArray(mz) || !mz.length) return "This PSM has no stored peaks";
  }
  return "";
}

/** The PsmKey of a psm-view result row. */
export function psmKeyOf(columns: string[], row: unknown[] | undefined): PsmKey {
  const scan = rowValue(columns, row, COL.scan);
  const charge = rowValue(columns, row, COL.charge);
  const run = rowValue(columns, row, COL.run_file_name);
  return {
    peptidoform: String(rowValue(columns, row, COL.peptidoform)),
    run_file_name: run == null ? null : String(run),
    scan: Array.isArray(scan) ? (scan[0] as number) ?? null : ((scan as number) ?? null),
    charge: (charge as number) ?? null,
  };
}

// scan is a list of scan numbers in some files.
const scanWhere = (P: TableRef, scan: unknown) =>
  /\[\]|list/i.test(P.types.scan ?? "") ? `list_contains(${COL.scan}, ${Number(scan)})` : `${COL.scan} = ${Number(scan)}`;

function psmWhere(P: TableRef, t: PsmKey): string {
  const parts = [`${COL.peptidoform} = ${lit(t.peptidoform)}`];
  if (t.run_file_name != null && P.cols.has(COL.run_file_name)) parts.push(`${COL.run_file_name} = ${lit(String(t.run_file_name))}`);
  if (t.scan != null && P.cols.has(COL.scan)) parts.push(scanWhere(P, t.scan));
  if (t.charge != null && P.cols.has(COL.charge)) parts.push(`${COL.charge} = ${Number(t.charge)}`);
  return parts.join(" AND ");
}

/** The PSM's row (identification, scores, cv_params and peak arrays);
 * undefined when the psm view has no such PSM. */
export async function psmRecord(P: TableRef, t: PsmKey): Promise<Record<string, any> | undefined> {
  const want = SPECTRUM_COLUMNS.filter((c) => P.cols.has(c));
  const r = await runSql(`SELECT ${want.map(ident).join(", ")} FROM ${ident(P.table)} WHERE ${psmWhere(P, t)} LIMIT 1`, 1);
  return objects(r)[0];
}

/** Up to 201 PSMs of the peptidoform, best PEP first: run, scan, charge, PEP. */
export async function peptidoformPsms(P: TableRef, peptidoform: string): Promise<Record<string, any>[]> {
  const want = [COL.run_file_name, COL.scan, COL.charge, COL.posterior_error_probability].filter((c) => P.cols.has(c));
  const order = P.cols.has(COL.posterior_error_probability) ? ` ORDER BY ${COL.posterior_error_probability}` : "";
  const r = await runSql(`SELECT ${want.map(ident).join(", ")} FROM ${ident(P.table)} WHERE ${COL.peptidoform} = ${lit(peptidoform)}${order} LIMIT 201`, 201);
  return objects(r);
}

/** Peak arrays and charge of the peptidoform's PSM `o` (a row of
 * peptidoformPsms); undefined when the view has no such row. */
export async function psmPeaks(P: TableRef, peptidoform: string, o: Record<string, any>): Promise<Record<string, any> | undefined> {
  const sc = Array.isArray(o.scan) ? o.scan[0] : o.scan;
  const parts = [`${COL.peptidoform} = ${lit(peptidoform)}`];
  if (o.run_file_name != null) parts.push(`${COL.run_file_name} = ${lit(String(o.run_file_name))}`);
  if (sc != null) parts.push(scanWhere(P, sc));
  if (o.charge != null) parts.push(`${COL.charge} = ${Number(o.charge)}`);
  const r = await runSql(`SELECT ${COL.mz_array}, ${COL.intensity_array}, ${COL.charge} FROM ${ident(P.table)} WHERE ${parts.join(" AND ")} LIMIT 1`, 1);
  return objects(r)[0];
}

/** "run · scan N · z+ · PEP x" for a PSM row. */
export function psmLabel(r: Record<string, any>): string {
  const sc = Array.isArray(r.scan) ? r.scan[0] : r.scan;
  const parts = [r.run_file_name ? String(r.run_file_name) : "", sc != null ? `scan ${sc}` : "", r.charge != null ? `${r.charge}+` : ""];
  if (r.posterior_error_probability != null) parts.push(`PEP ${Number(r.posterior_error_probability).toExponential(1)}`);
  return parts.filter(Boolean).join(" · ");
}
