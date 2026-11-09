import { describe, expect, it } from "vitest";
import { isNumericScalar } from "./summary";

describe("isNumericScalar", () => {
  it("accepts numeric scalar types", () => {
    for (const t of ["INTEGER", "BIGINT", "DOUBLE", "FLOAT", "DECIMAL(18,3)", "UBIGINT", " real "]) expect(isNumericScalar(t)).toBe(true);
  });
  it("rejects nested and non-numeric types", () => {
    for (const t of ["MAP(VARCHAR, BIGINT)", "INTEGER[]", "STRUCT(a INTEGER)", "VARCHAR", "BOOLEAN", "ENUM('a')", "UNION(a INTEGER)"]) {
      expect(isNumericScalar(t)).toBe(false);
    }
  });
});
