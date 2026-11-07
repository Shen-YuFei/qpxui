import { describe, expect, it } from "vitest";
import type { ViewInfo } from "./api";
import { forgetTableNames, tableName } from "./duck";

const view = (path: string): ViewInfo => ({ name: path.split("/").pop()!, view: "psm", format: "parquet", path, sizeBytes: 1 });

describe("tableName", () => {
  it("gives views that share a file name their own tables", () => {
    const a = tableName(view("/x/a/PXD1.psm.parquet"));
    const b = tableName(view("/x/b/PXD1.psm.parquet"));
    expect(a).toBe("PXD1_psm");
    expect(b).not.toBe(a);
    expect(tableName(view("/x/a/PXD1.psm.parquet"))).toBe(a);
  });

  it("lets a new source reuse the names", () => {
    tableName(view("/x/a/PXD2.psm.parquet"));
    forgetTableNames();
    expect(tableName(view("/y/PXD2.psm.parquet"))).toBe("PXD2_psm");
  });
});
