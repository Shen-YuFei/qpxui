// The PTMs tab (and the Peptidoforms tab's modification filter): counts of
// each modification, its sites and modifications per peptide, over the
// target rows of the evidence view.
import type { DatasetInfo } from "../api";
import type { ChartSpec } from "../charts";
import { cachedSql, ident, objects, targetWhere, type TableRef } from "../report";
import { COL } from "../qpx";

/** Evidence-view columns the tab reads (for the large-view gate). */
export const PTM_COLUMNS = [COL.is_decoy, COL.modifications, COL.peptidoform, COL.sequence];

/** Target rows of the evidence view. */
export async function targetCount(ds: DatasetInfo, ev: TableRef): Promise<number> {
  const total = await cachedSql(ds, "ptm.total", `SELECT count(*) FROM ${ident(ev.table)} WHERE ${targetWhere(ev)}`);
  return Number(total.rows[0]?.[0] ?? 0);
}

/** Each modification (name, accession) with its distinct peptidoforms
 * (n_pf), peptides (n_pep) and evidence rows (n_ev), most rows first. */
export async function modificationCounts(ds: DatasetInfo, ev: TableRef): Promise<Record<string, any>[]> {
  const pf = ev.cols.has(COL.peptidoform) ? COL.peptidoform : ev.seq;
  const r = await cachedSql(
    ds,
    "ptm.mods",
    `SELECT m.name AS name, any_value(m.accession) AS accession,
              count(DISTINCT pf)::BIGINT AS n_pf, count(DISTINCT seq)::BIGINT AS n_pep, count(*)::BIGINT AS n_ev
       FROM (SELECT unnest(${COL.modifications}) AS m, ${pf} AS pf, ${ev.seq} AS seq FROM ${ident(ev.table)} WHERE ${targetWhere(ev)})
       GROUP BY 1 ORDER BY n_ev DESC`
  );
  return objects(r);
}

/** Modified residues (or N-term) per modification: rows of (name, aa, n). */
export async function modificationSites(ds: DatasetInfo, ev: TableRef): Promise<Record<string, any>[]> {
  const s = await cachedSql(
    ds,
    "ptm.sites",
    `SELECT name, coalesce(p.amino_acid, CASE WHEN p.position = 0 THEN 'N-term' ELSE '?' END) AS aa, count(*)::BIGINT AS n
       FROM (SELECT m.name AS name, unnest(m.positions) AS p
             FROM (SELECT unnest(${COL.modifications}) AS m FROM ${ident(ev.table)} WHERE ${targetWhere(ev)}))
       GROUP BY ALL ORDER BY n DESC`
  );
  return objects(s);
}

/** Evidence rows by number of modification types (6 = 6 or more). */
export async function modificationsPerPeptide(ds: DatasetInfo, ev: TableRef, evName: string): Promise<ChartSpec> {
  const k = await cachedSql(
    ds,
    "ptm.perpep",
    `SELECT least(len(list_filter(${COL.modifications}, x -> x.name IS NOT NULL)), 6) AS k, count(*)::BIGINT
       FROM ${ident(ev.table)} WHERE ${targetWhere(ev)} GROUP BY 1 ORDER BY 1`
  );
  return {
    kind: "bar",
    labels: k.rows.map((x) => (Number(x[0]) === 6 ? "6+" : String(x[0]))),
    series: [{ name: evName, values: k.rows.map((x) => Number(x[1])) }],
    xName: "modification types per peptide (incl. fixed)",
  };
}
