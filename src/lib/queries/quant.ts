// The Quantification tab: the protein × sample abundance matrix, from the pg
// view's intensities or features summed per protein, with run channels
// mapped to samples through the run view; and the sample metadata.
import type { DatasetInfo } from "../api";
import { natural, type QuantMatrix } from "../quant";
import { cachedSql, ident, objects, proteinExpr, sampleMapSql, targetWhere, type DatasetTables, type TableRef } from "../report";

/** Columns the matrix query reads (for the large-view gate). */
export const QUANT_COLUMNS = ["is_decoy", "anchor_protein", "protein_accessions", "pg_accessions", "gg_names", "run_file_name", "contaminant", "intensities"];

const hasInt = (r?: TableRef) => !!r?.cols.has("intensities");

/** The view the matrix comes from: the pg view when it has intensities,
 * else the feature view; none when neither has. */
export function quantSource(t: DatasetTables): { ref: TableRef; kind: "pg" | "feature" } | undefined {
  if (hasInt(t.pg)) return { ref: t.pg!, kind: "pg" };
  if (hasInt(t.feature)) return { ref: t.feature!, kind: "feature" };
  return undefined;
}

function matrixSql(t: DatasetTables, S: TableRef, kind: "pg" | "feature"): string {
  const prot = kind === "pg" ? "anchor_protein" : proteinExpr(S);
  const gene = S.cols.has("gg_names") ? "gg_names[1]" : "NULL";
  const run = S.cols.has("run_file_name") ? "run_file_name" : "'all'";
  // The contaminant flag is not always set; also match the usual name tags.
  const byName = `(contains(upper(${prot}), 'CONTAMINANT') OR contains(upper(${prot}), 'CON__'))`;
  const cont = S.cols.has("contaminant") ? `(coalesce(contaminant, false) OR ${byName})` : byName;
  const R = t.run?.cols.has("samples") ? t.run : undefined;
  const { ctes: maps, joins, col } = sampleMapSql(R);
  return `
WITH x AS (
  SELECT ${prot} AS p, ${gene} AS g, ${run} AS r, ${cont} AS c, unnest(intensities) AS i
  FROM ${ident(S.table)}
  WHERE ${targetWhere(S)} AND ${prot} IS NOT NULL AND len(intensities) > 0
)${maps}
SELECT x.p AS protein, any_value(x.g) AS gene, bool_or(x.c) AS cont, ${col} AS col,
       sum(x.i.intensity)::DOUBLE AS v, ${R ? "bool_and(m.sa IS NULL AND m1.sa IS NOT NULL)" : "false"} AS by_run,
       ${R ? "bool_and(m.sa IS NULL AND m1.sa IS NULL AND x.r IN (SELECT r FROM m))" : "false"} AS unmapped
FROM x ${joins}
WHERE x.i.intensity > 0
GROUP BY x.p, col`;
}

export interface QuantResult {
  /** log2 abundances, proteins × columns (samples, or runs and channels). */
  matrix: QuantMatrix;
  /** 1 for proteins flagged or named as contaminants. */
  contaminant: Uint8Array;
  /** Every column is a run mapped to a sample as a whole (no channels). */
  byRunOnly: boolean;
  /** Run channels left out because the run view maps no sample to them. */
  unmapped: number;
  /** The long-format result hit the row cap, so the matrix is incomplete. */
  truncated: boolean;
}

/** The abundance matrix of the source view. */
export async function quantMatrix(ds: DatasetInfo, t: DatasetTables, src: { ref: TableRef; kind: "pg" | "feature" }): Promise<QuantResult> {
  const r = await cachedSql(ds, `quant.${src.kind}`, matrixSql(t, src.ref, src.kind), 5_000_000);
  const [ip, ig, ic, icol, iv, ibr] = ["protein", "gene", "cont", "col", "v", "by_run"].map((c) => r.columns.indexOf(c));
  const iun = r.columns.indexOf("unmapped");
  const cols = new Map<string, number>();
  const prots = new Map<string, number>();
  const dropped = new Set<string>();
  const rowsIn = r.rows.filter((row) => {
    if (!row[iun]) return true;
    dropped.add(String(row[icol]));
    return false;
  });
  for (const row of rowsIn) {
    const c = String(row[icol]);
    if (!cols.has(c)) cols.set(c, 0);
    const p = String(row[ip]);
    if (!prots.has(p)) prots.set(p, prots.size);
  }
  const samples = [...cols.keys()].sort(natural);
  samples.forEach((s, j) => cols.set(s, j));
  const n = samples.length;
  const values = Array.from({ length: prots.size }, () => new Float64Array(n).fill(NaN));
  const genes: (string | null)[] = new Array(prots.size).fill(null);
  const cont = new Uint8Array(prots.size);
  let runOnly = rowsIn.length > 0;
  for (const row of rowsIn) {
    const i = prots.get(String(row[ip]))!;
    const v = Number(row[iv]);
    if (v > 0) values[i][cols.get(String(row[icol]))!] = Math.log2(v);
    if (row[ig] != null) genes[i] = String(row[ig]);
    if (row[ic]) cont[i] = 1;
    if (!row[ibr]) runOnly = false;
  }
  return {
    matrix: { samples, proteins: [...prots.keys()], genes, values },
    contaminant: cont,
    byRunOnly: runOnly,
    unmapped: dropped.size,
    truncated: r.truncated,
  };
}

/** Sample view rows by sample accession (shared by the Quantification tab
 * and the peptidoform profile). */
export async function sampleMeta(ds: DatasetInfo, sample: TableRef): Promise<Map<string, Record<string, any>>> {
  const s = await cachedSql(ds, "quant.samples", `SELECT * FROM ${ident(sample.table)}`, 100000);
  return new Map(objects(s).map((x) => [String(x.sample_accession), x]));
}
