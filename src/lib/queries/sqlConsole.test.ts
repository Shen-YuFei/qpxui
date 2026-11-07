import { describe, expect, it } from "vitest";
import { QUERY_EXAMPLES, querySql, substituteTable } from "./sqlConsole";

describe("querySql", () => {
  it("caps a query without a LIMIT", () => {
    expect(querySql("SELECT * FROM {table}", "psm")).toBe('SELECT * FROM "psm" LIMIT 2000');
  });
  it("keeps the query's own trailing LIMIT", () => {
    expect(querySql("select 1 limit 10 ", "psm")).toBe("select 1 limit 10");
  });
  it("caps a LIMIT that is not at the end", () => {
    expect(querySql("SELECT * FROM (SELECT * FROM {table} LIMIT 5) ORDER BY 1", "t")).toBe(
      'SELECT * FROM (SELECT * FROM "t" LIMIT 5) ORDER BY 1 LIMIT 2000'
    );
  });
  it("reads the whole table for empty text", () => {
    expect(querySql("  ", "pg")).toBe('SELECT * FROM "pg" LIMIT 2000');
  });
});

describe("substituteTable", () => {
  it("replaces only the first placeholder", () => {
    expect(substituteTable("{table} {table}", "a")).toBe('"a" {table}');
  });
  it("gives the default query from the first example", () => {
    expect(substituteTable(QUERY_EXAMPLES[0], "psm")).toBe('SELECT * FROM "psm" LIMIT 50');
  });
});
