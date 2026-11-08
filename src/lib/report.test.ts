import { describe, expect, it } from "vitest";
import type { QueryResult } from "./duck";
import { histogramData, ident, likePattern, lit, parseSortOrder, proteinExpr, proteinMatchWhere, sampleMapSql, targetWhere, type TableRef } from "./report";

function ref(types: Record<string, string>): TableRef {
  return {
    view: { name: "x.feature.parquet", view: "feature", format: "parquet", path: "/x.feature.parquet", sizeBytes: 0 },
    table: "x_feature",
    cols: new Set(Object.keys(types)),
    types,
    seq: "sequence",
  };
}

describe("SQL quoting", () => {
  it("escapes literals and identifiers", () => {
    expect(lit("O'Brien")).toBe("'O''Brien'");
    expect(ident('a"b')).toBe('"a""b"');
  });

  it("escapes LIKE wildcards", () => {
    expect(likePattern("50%_a\\b")).toBe("'%50\\%\\_a\\\\b%' ESCAPE '\\'");
  });
});

describe("schema-dependent expressions", () => {
  it("prefers the anchor protein, then the first accession", () => {
    expect(proteinExpr(ref({ anchor_protein: "VARCHAR", pg_accessions: "VARCHAR[]" }))).toBe("anchor_protein");
    expect(proteinExpr(ref({ pg_accessions: "STRUCT(accession VARCHAR)[]" }))).toBe("pg_accessions[1].accession");
    expect(proteinExpr(ref({ pg_accessions: "VARCHAR[]" }))).toBe("pg_accessions[1]");
    expect(proteinExpr(ref({ sequence: "VARCHAR" }))).toBeNull();
  });

  it("matches a protein by anchor or group member", () => {
    expect(proteinMatchWhere(ref({ anchor_protein: "VARCHAR", protein_accessions: "VARCHAR[]" }), "P1")).toBe(
      "(anchor_protein = 'P1' OR list_contains(protein_accessions, 'P1'))",
    );
  });

  it("drops decoys only when the column exists", () => {
    expect(targetWhere(ref({ is_decoy: "BOOLEAN" }))).toBe("NOT coalesce(is_decoy, false)");
    expect(targetWhere(ref({}))).toBe("TRUE");
  });

  it("maps channels to samples only with a run view that lists them", () => {
    expect(sampleMapSql(undefined).mapped).toBe(false);
    const run = ref({ run_file_name: "VARCHAR", samples: "STRUCT(sample_accession VARCHAR, label VARCHAR)[]" });
    expect(sampleMapSql(run).mapped).toBe(true);
  });
});

describe("histogramData", () => {
  it("places counts at bin starts and includes intervals", () => {
    const r: QueryResult = { columns: ["bin", "n", "lo", "hi"], rows: [[0, 3, 0, 4], [3, 1, 0, 4]], rowCount: 2, truncated: false };
    expect(histogramData(r, 4)).toEqual({ labels: ["0", "1", "2", "3"], values: [3, 0, 0, 1], ranges: ["[0, 1)", "[1, 2)", "[2, 3)", "[3, 4]"] });
  });
  it("uses one bin for a constant column and keeps 64-bit id bounds readable", () => {
    const result = (rows: number[][]): QueryResult => ({ columns: ["bin", "n", "lo", "hi"], rows, rowCount: rows.length, truncated: false });
    expect(histogramData(result([[0, 5, 7, 7]]))).toEqual({ labels: ["7"], values: [5], ranges: ["[7, 7]"] });
    const ids = histogramData(result([[0, 2, -9e18, 9e18], [3, 1, -9e18, 9e18]]), 4);
    expect(ids.labels[0]).toBe((-9e18).toLocaleString());
    expect(ids.labels[2]).toBe("0");
    expect(ids.ranges.join(" ")).not.toMatch(/NaN|Infinity/);
  });
  it("ends an integer column's last bin at the last whole number it holds", () => {
    const r: QueryResult = { columns: ["bin", "n", "lo", "hi"], rows: [[0, 5, 7, 8]], rowCount: 1, truncated: false };
    expect(histogramData(r, 1, true).ranges).toEqual(["[7, 7]"]);
  });
});

describe("parseSortOrder", () => {
  it("splits the comma-separated sort columns", () => {
    expect(parseSortOrder("anchor_protein,peptidoform,charge")).toEqual(["anchor_protein", "peptidoform", "charge"]);
  });
});
