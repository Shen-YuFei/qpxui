// The Summary view of one table: counts by charge, protein, run, score and
// missed cleavages, and a histogram of one numeric column.
import { runSql } from "../duck";
import { histogramData, ident } from "../report";
import { COL } from "../qpx";

/** Whether a column of this DuckDB type can be binned. Only types whose
 * scalar base is numeric qualify: nested types (MAP, LIST, ARRAY, STRUCT,
 * ENUM, UNION) do not, though `MAP(VARCHAR, BIGINT)` contains "int". */
export function isNumericScalar(type: string): boolean {
  const t = type.trim();
  if (/map|list|array|struct|union|enum|\[/i.test(t)) return false;
  const base = t.split(/[[(]/)[0].trim().toLowerCase();
  return [
    "tinyint", "smallint", "integer", "bigint", "hugeint",
    "utinyint", "usmallint", "uinteger", "ubigint", "uhugeint",
    "float", "real", "double", "decimal", "numeric",
  ].includes(base);
}

/** One bar chart: category labels and their counts. */
export interface CountChart {
  label: string;
  key: string;
  labels: string[];
  values: number[];
}

async function counts(label: string, sql: string, key: string): Promise<CountChart> {
  const r = await runSql(sql);
  return { label, key, labels: r.rows.map((row) => String(row[0] ?? "∅")), values: r.rows.map((row) => Number(row[1] ?? 0)) };
}

/** The count charts the table's columns (lower-case `names`) support, those
 * with data; `unit` names a row ("PSMs", "features", …). */
export async function summaryCounts(table: string, names: Set<string>, unit: string): Promise<CountChart[]> {
  const t = ident(table);
  const list: CountChart[] = [];
  const push = (c: CountChart) => {
    if (c.values.length) list.push(c);
  };
  if (names.has(COL.charge)) {
    push(await counts("Charge distribution", `SELECT ${COL.charge} AS k, COUNT(*) AS n FROM ${t} GROUP BY 1 ORDER BY 1`, "charge"));
  }
  if (names.has(COL.anchor_protein) || names.has(COL.pg_accessions)) {
    const col = names.has(COL.anchor_protein) ? COL.anchor_protein : COL.pg_accessions;
    push(await counts(`Top ${col === COL.anchor_protein ? "anchor proteins" : "protein groups"} by ${unit}`, `SELECT ${col} AS k, COUNT(*) AS n FROM ${t} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 25`, "protein"));
  }
  if (names.has(COL.run_file_name)) {
    push(await counts(`${unit[0].toUpperCase()}${unit.slice(1)} per run`, `SELECT ${COL.run_file_name} AS k, COUNT(*) AS n FROM ${t} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`, "run"));
  }
  if (names.has(COL.peptide_qvalue) || names.has(COL.posterior_error_probability)) {
    const col = names.has(COL.peptide_qvalue) ? COL.peptide_qvalue : COL.posterior_error_probability;
    push(await counts(`${col} distribution`, `SELECT round(${col},2) AS k, COUNT(*) AS n FROM ${t} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 1`, "q"));
  }
  if (names.has(COL.missed_cleavages)) {
    push(await counts("Missed cleavages", `SELECT ${COL.missed_cleavages} AS k, COUNT(*) AS n FROM ${t} GROUP BY 1 ORDER BY 1`, "mc"));
  }
  return list;
}

/** Up to 30 equal-width bins, with whole-number boundaries for integer columns. */
export async function columnHistogram(table: string, col: string, type = "DOUBLE") {
  const t = ident(table);
  // In DOUBLE: max - min of 64-bit ids overflows BIGINT.
  const x = `${ident(col)}::DOUBLE`;
  const integer = /^u?(tinyint|smallint|integer|bigint|hugeint)$/i.test(type);
  const width = integer ? "greatest(1, ceil((mx - mn + 1) / 30.0))" : "coalesce(nullif((mx - mn)/30.0, 0), 1)";
  const bins = integer ? "least(30, floor((mx - mn) / w) + 1)::INT" : "CASE WHEN mx = mn THEN 1 ELSE 30 END";
  const q = `
    WITH stats AS (
      SELECT min(${x}) AS mn, max(${x}) AS mx
      FROM ${t} WHERE isfinite(${x})
    ), widths AS (
      SELECT mn, mx, ${width} AS w FROM stats
    ), bounds AS (
      SELECT mn, w, ${bins} AS bins FROM widths
    )
    SELECT least(bins - 1, floor((${x} - mn) / w))::INT AS bin,
           COUNT(*) AS n, any_value(mn) AS lo, any_value(mn + w * bins) AS hi, any_value(bins) AS bins
    FROM ${t}, bounds WHERE isfinite(${x})
    GROUP BY 1 ORDER BY 1`;
  const r = await runSql(q);
  return histogramData(r, Number(r.rows[0]?.[4] ?? 30), integer);
}
