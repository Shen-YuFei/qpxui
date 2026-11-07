import { describe, expect, it } from "vitest";
import { cellFilter, pageSql, selectList } from "./table";

describe("selectList", () => {
  const cols = ["psm_id", "mz_array", "charge", "Intensity_Array"];
  it("moves the peak arrays last", () => {
    expect(selectList(cols, true)).toBe('"psm_id", "charge", "mz_array", "Intensity_Array"');
  });
  it("leaves the peak arrays out when hidden", () => {
    expect(selectList(cols, false)).toBe('"psm_id", "charge"');
  });
  it("selects everything before the columns are known", () => {
    expect(selectList([], false)).toBe("*");
  });
});

describe("pageSql", () => {
  it("adds the filter, the sort and the page", () => {
    expect(pageSql({ table: "psm", cols: ["a"], peaks: true, where: " charge >= 3 ", sort: { col: "a", dir: "DESC" }, page: 2, pageSize: 500 })).toBe(
      'SELECT "a" FROM "psm" WHERE charge >= 3 ORDER BY "a" DESC LIMIT 500 OFFSET 1000'
    );
  });
  it("reads the first page unfiltered and unsorted", () => {
    expect(pageSql({ table: "pg", cols: [], peaks: false, where: "", sort: null, page: 0, pageSize: 500 })).toBe('SELECT * FROM "pg" LIMIT 500 OFFSET 0');
  });
});

describe("cellFilter", () => {
  it("matches NULL, strings and integers", () => {
    expect(cellFilter("run", null)).toBe('"run" IS NULL');
    expect(cellFilter("run", "a'b")).toBe(`"run" = 'a''b'`);
    expect(cellFilter("charge", 3)).toBe('"charge" = 3');
    expect(cellFilter("psm_id", 3619665049874577583n)).toBe('"psm_id" = 3619665049874577583');
  });
  it("compares other values as text", () => {
    expect(cellFilter("decoy", true)).toBe(`CAST("decoy" AS VARCHAR) = 'true'`);
    expect(cellFilter("x", Infinity)).toBe(`CAST("x" AS VARCHAR) = 'Infinity'`);
  });
});
