import { describe, expect, it } from "vitest";
import { fmtBytes, formatCompact, listText, scalarText } from "./format";

describe("scalarText", () => {
  it("marks missing values", () => {
    expect(scalarText(null)).toBe("∅");
    expect(scalarText(undefined)).toBe("∅");
  });

  it("keeps at most four decimals", () => {
    expect(scalarText(0.123456)).toBe((0.1235).toLocaleString(undefined, { maximumFractionDigits: 4 }));
  });
});

describe("formatCompact", () => {
  it("summarises a QPX score list by name", () => {
    const scores = [
      { score_name: "q", score_value: 0.01, higher_better: false },
      { score_name: "pep", score_value: 0.5, higher_better: false },
    ];
    expect(formatCompact(scores)).toBe(`q=${scalarText(0.01)}, pep=${scalarText(0.5)}`);
  });

  it("joins modification names", () => {
    expect(formatCompact([{ name: "Oxidation", accession: "UNIMOD:35" }, { name: "Phospho", accession: "UNIMOD:21" }])).toBe(
      "Oxidation + Phospho",
    );
  });

  it("shortens long scalar lists", () => {
    expect(formatCompact([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe("[1, 2, 3, …] (9 values)");
    expect(formatCompact([])).toBe("∅ (empty list)");
  });
});

describe("fmtBytes", () => {
  it("uses binary units", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});

describe("listText", () => {
  it("shows struct elements in their compact form", () => {
    expect(listText([{ sample_accession: "S1", label: "lf" }])).toBe("{ sample_accession: S1, label: lf }");
    expect(listText(["a", "b", "c", "d"])).toBe("a, b, c +1");
  });
});
