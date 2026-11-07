// The spectrum viewer: one PSM's identification and peaks from the psm view,
// the other PSMs of its peptidoform, and one of those PSMs' peaks.
import { runSql } from "../duck";
import { ident, lit, objects, type TableRef } from "../report";

/** A PSM of the psm view, as the tables that open the viewer know it. */
export interface PsmKey {
  peptidoform: string;
  run_file_name?: string | null;
  scan?: number | null;
  charge?: number | null;
}

/** Columns of the PSM row the viewer reads (those the view has). */
const SPECTRUM_COLUMNS = ["peptidoform", "charge", "run_file_name", "scan", "calculated_mz", "observed_mz", "posterior_error_probability",
  "rt", "cv_params", "mz_array", "intensity_array", "charge_array", "ion_type_array"];

// scan is a list of scan numbers in some files.
const scanWhere = (P: TableRef, scan: unknown) =>
  /\[\]|list/i.test(P.types.scan ?? "") ? `list_contains(scan, ${Number(scan)})` : `scan = ${Number(scan)}`;

function psmWhere(P: TableRef, t: PsmKey): string {
  const parts = [`peptidoform = ${lit(t.peptidoform)}`];
  if (t.run_file_name != null && P.cols.has("run_file_name")) parts.push(`run_file_name = ${lit(String(t.run_file_name))}`);
  if (t.scan != null && P.cols.has("scan")) parts.push(scanWhere(P, t.scan));
  if (t.charge != null && P.cols.has("charge")) parts.push(`charge = ${Number(t.charge)}`);
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
  const want = ["run_file_name", "scan", "charge", "posterior_error_probability"].filter((c) => P.cols.has(c));
  const order = P.cols.has("posterior_error_probability") ? " ORDER BY posterior_error_probability" : "";
  const r = await runSql(`SELECT ${want.map(ident).join(", ")} FROM ${ident(P.table)} WHERE peptidoform = ${lit(peptidoform)}${order} LIMIT 201`, 201);
  return objects(r);
}

/** Peak arrays and charge of the peptidoform's PSM `o` (a row of
 * peptidoformPsms); undefined when the view has no such row. */
export async function psmPeaks(P: TableRef, peptidoform: string, o: Record<string, any>): Promise<Record<string, any> | undefined> {
  const sc = Array.isArray(o.scan) ? o.scan[0] : o.scan;
  const parts = [`peptidoform = ${lit(peptidoform)}`];
  if (o.run_file_name != null) parts.push(`run_file_name = ${lit(String(o.run_file_name))}`);
  if (sc != null) parts.push(scanWhere(P, sc));
  if (o.charge != null) parts.push(`charge = ${Number(o.charge)}`);
  const r = await runSql(`SELECT mz_array, intensity_array, charge FROM ${ident(P.table)} WHERE ${parts.join(" AND ")} LIMIT 1`, 1);
  return objects(r)[0];
}
