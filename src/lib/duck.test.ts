import { Field, Int32, makeData, RecordBatch, Schema, Struct, Table } from "apache-arrow";
import { describe, expect, it } from "vitest";
import type { ViewInfo } from "./api";
import { forgetTables, readRows, registered, tableName } from "./duck";

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
    forgetTables();
    expect(tableName(view("/y/PXD2.psm.parquet"))).toBe("PXD2_psm");
  });

  it("registers a new source's views again", () => {
    registered.add("/x/a/PXD3.psm.parquet");
    forgetTables();
    expect(registered.size).toBe(0);
  });
});

describe("readRows", () => {
  it("keeps the values of columns that share a name", () => {
    // SELECT 1 AS a, 2 AS a
    const fields = [new Field("a", new Int32()), new Field("a", new Int32())];
    const int = (x: number) => makeData({ type: new Int32(), length: 1, data: Int32Array.of(x) });
    const batch = new RecordBatch(new Schema(fields), makeData({ type: new Struct(fields), length: 1, children: [int(1), int(2)] }));
    expect(readRows(new Table(batch))).toEqual([[1, 2]]);
  });
});
