// The peptidoform profile (Peptidoforms tab): every feature (or PSM) of one
// peptidoform with its intensity in each sample, runs and channels mapped to
// samples through the run view; the run list; per-sample medians.
import type { DatasetInfo } from "../api";
import { runSql } from "../duck";
import type { Feature } from "../peptidoformCharts";
import { natural } from "../quant";
import { cachedSql, ident, lit, objects, sampleMapSql, targetWhere, type DatasetTables, type TableRef } from "../report";

/** Features read per peptidoform; one more is read to tell that there are more. */
export const PROFILE_MAX_FEATURES = 20000;

/** One feature's intensity in one sample (or run channel). */
export interface Channel {
  fid: number;
  sample: string;
  label: string | null;
  intensity: number;
}

const hasInt = (r?: TableRef) => !!r?.cols.has("intensities");

/** Quantified evidence first: features, then PSMs that carry intensities. */
export function profileSource(t: DatasetTables): TableRef | undefined {
  return hasInt(t.feature) ? t.feature : hasInt(t.psm) ? t.psm : t.feature ?? t.psm;
}

const pfCol = (S: TableRef) => (S.cols.has("peptidoform") ? "peptidoform" : S.seq);

function profileSql(t: DatasetTables, S: TableRef, peptidoform: string): string {
  const has = (c: string) => S.cols.has(c);
  const sec = (c: string) => (has(c) ? `${c} / 60.0` : "NULL");
  const quant = hasInt(S);
  const map = sampleMapSql(t.run);
  const f = `f AS MATERIALIZED (
  SELECT row_number() OVER ()::BIGINT AS fid, ${has("run_file_name") ? "run_file_name" : "'all'"} AS r,
         ${has("charge") ? "charge" : "NULL"} AS z, ${sec("rt")} AS rt, ${sec("rt_start")} AS rt_lo, ${sec("rt_stop")} AS rt_hi,
         ${has("posterior_error_probability") ? "posterior_error_probability" : "NULL"} AS pep${quant ? ", intensities" : ""}
  FROM ${ident(S.table)} WHERE ${targetWhere(S)} AND ${pfCol(S)} = ${lit(peptidoform)}
  LIMIT ${PROFILE_MAX_FEATURES + 1})`;
  if (!quant) {
    return `WITH ${f} SELECT fid, r AS run, z AS charge, rt, rt_lo, rt_hi, pep, NULL AS label, NULL AS sample, NULL AS intensity FROM f ORDER BY fid`;
  }
  return `WITH ${f},
x AS (SELECT fid, r, unnest(intensities) AS i FROM f WHERE len(intensities) > 0)${map.ctes},
s AS (SELECT x.fid, x.i.label AS label, ${map.col} AS sample, x.i.intensity::DOUBLE AS intensity FROM x ${map.joins} WHERE x.i.intensity > 0)
SELECT f.fid, f.r AS run, f.z AS charge, f.rt, f.rt_lo, f.rt_hi, f.pep, s.label, s.sample, s.intensity
FROM f LEFT JOIN s USING (fid) ORDER BY f.fid`;
}

const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** The peptidoform's features in `S` (at most PROFILE_MAX_FEATURES) and
 * their positive intensities per sample. */
export async function peptidoformProfile(
  t: DatasetTables,
  S: TableRef,
  peptidoform: string
): Promise<{ features: Feature[]; channels: Channel[]; truncated: boolean }> {
  const r = await runSql(profileSql(t, S, peptidoform), PROFILE_MAX_FEATURES * 40);
  const fs = new Map<number, Feature>();
  const ch: Channel[] = [];
  for (const row of objects(r)) {
    const fid = Number(row.fid);
    if (!fs.has(fid)) {
      fs.set(fid, {
        fid,
        run: String(row.run),
        charge: num(row.charge),
        rt: num(row.rt),
        rtLo: num(row.rt_lo),
        rtHi: num(row.rt_hi),
        pep: num(row.pep),
      });
    }
    const v = num(row.intensity);
    if (row.sample != null && v != null && v > 0) ch.push({ fid, sample: String(row.sample), label: row.label == null ? null : String(row.label), intensity: v });
  }
  return { features: [...fs.values()].slice(0, PROFILE_MAX_FEATURES), channels: ch, truncated: fs.size > PROFILE_MAX_FEATURES };
}

/** Every run of the run view, in natural order. */
export async function runNames(ds: DatasetInfo, run: TableRef): Promise<string[]> {
  const r = await cachedSql(ds, "pep.runs", `SELECT DISTINCT run_file_name FROM ${ident(run.table)}`, 100000);
  return r.rows.map((x) => String(x[0])).sort(natural);
}

/** Median log2 intensity of every sample over all target evidence of `S`,
 * for normalisation. */
export async function sampleMedians(ds: DatasetInfo, t: DatasetTables, S: TableRef): Promise<Map<string, number>> {
  const map = sampleMapSql(t.run);
  const r = await cachedSql(
    ds,
    `pep.medians.${S === t.feature ? "feature" : "psm"}`,
    `WITH x AS (SELECT run_file_name AS r, unnest(intensities) AS i FROM ${ident(S.table)} WHERE ${targetWhere(S)} AND len(intensities) > 0)${map.ctes}
       SELECT ${map.col} AS sample, median(log2(x.i.intensity)) AS med FROM x ${map.joins} WHERE x.i.intensity > 0 GROUP BY 1`,
    100000
  );
  return new Map(r.rows.map((x) => [String(x[0]), Number(x[1])]));
}
