// The Summary view of one table: counts by charge, protein, run, score and
// missed cleavages, and a histogram of one numeric column.
import { runSql } from "../duck";
import { ident } from "../report";

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
  if (names.has("charge")) {
    push(await counts("Charge distribution", `SELECT charge AS k, COUNT(*) AS n FROM ${t} GROUP BY 1 ORDER BY 1`, "charge"));
  }
  if (names.has("anchor_protein") || names.has("pg_accessions")) {
    const col = names.has("anchor_protein") ? "anchor_protein" : "pg_accessions";
    push(await counts(`Top ${col === "anchor_protein" ? "anchor proteins" : "protein groups"} by ${unit}`, `SELECT ${col} AS k, COUNT(*) AS n FROM ${t} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 25`, "protein"));
  }
  if (names.has("run_file_name")) {
    push(await counts(`${unit[0].toUpperCase()}${unit.slice(1)} per run`, `SELECT run_file_name AS k, COUNT(*) AS n FROM ${t} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`, "run"));
  }
  if (names.has("peptide_qvalue") || names.has("posterior_error_probability")) {
    const col = names.has("peptide_qvalue") ? "peptide_qvalue" : "posterior_error_probability";
    push(await counts(`${col} distribution`, `SELECT round(${col},2) AS k, COUNT(*) AS n FROM ${t} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 1`, "q"));
  }
  if (names.has("missed_cleavages")) {
    push(await counts("Missed cleavages", `SELECT missed_cleavages AS k, COUNT(*) AS n FROM ${t} GROUP BY 1 ORDER BY 1`, "mc"));
  }
  return list;
}

/** Counts of a numeric column in 30 equal-width bins (labels are bin
 * indices). */
export async function columnHistogram(table: string, col: string): Promise<{ labels: string[]; values: number[] }> {
  const t = ident(table);
  // In DOUBLE: max - min of 64-bit ids overflows BIGINT.
  const x = `${ident(col)}::DOUBLE`;
  const q = `
    WITH stats AS (
      SELECT min(${x}) AS mn, (max(${x}) - min(${x}))/30.0 AS w
      FROM ${t} WHERE ${ident(col)} IS NOT NULL
    )
    SELECT (floor((${x} - (SELECT mn FROM stats)) / NULLIF((SELECT w FROM stats),0)))::INT AS bin,
           COUNT(*) AS n
    FROM ${t} WHERE ${ident(col)} IS NOT NULL
    GROUP BY 1 ORDER BY 1`;
  const r = await runSql(q);
  return { labels: r.rows.map((row) => String(row[0] ?? "")), values: r.rows.map((row) => Number(row[1] ?? 0)) };
}
