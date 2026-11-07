import { describe, expect, it } from "vitest";
import { fmtBytes, fmtCount, fmtSize, formatCompact, listText, peakSummary, scalarText, toJson } from "./format";

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

describe("fmtSize", () => {
  it("keeps one decimal in every unit and names a missing size", () => {
    expect(fmtSize(512)).toBe("512.0 B");
    expect(fmtSize(1536)).toBe("1.5 KB");
    expect(fmtSize(150 * 1024 ** 2)).toBe("150.0 MB");
    expect(fmtSize(0)).toBe("—");
    expect(fmtSize(null)).toBe("—");
    expect(fmtSize(0, "0 B")).toBe("0 B");
  });
});

describe("fmtCount", () => {
  it("shortens thousands and millions, keeping one decimal below ten", () => {
    expect(fmtCount(999)).toBe("999");
    expect(fmtCount(1200)).toBe("1.2K");
    expect(fmtCount(50_000)).toBe("50K");
    expect(fmtCount(5_600_000)).toBe("5.6M");
    expect(fmtCount(12_000_000)).toBe("12M");
  });

  it("marks a missing count", () => {
    expect(fmtCount(null)).toBe("—");
    expect(fmtCount(0)).toBe("0");
  });
});

describe("listText", () => {
  it("shows struct elements in their compact form", () => {
    expect(listText([{ sample_accession: "S1", label: "lf" }])).toBe("{ sample_accession: S1, label: lf }");
    expect(listText(["a", "b", "c", "d"])).toBe("a, b, c +1");
  });
});

describe("peakSummary", () => {
  it("counts the peaks of an array", () => {
    expect(peakSummary([1, 2, 3])).toBe("3 peaks");
    expect(peakSummary([])).toBe("no peaks");
    expect(peakSummary(null)).toBe("∅");
  });
});

describe("64-bit integers", () => {
  it("show every digit", () => {
    expect(scalarText(-2767409227554884324n)).toBe((-2767409227554884324n).toLocaleString());
  });
  it("are written to JSON as exact numbers", () => {
    expect(toJson({ psm_id: 3619665049874577583n, ids: [-2767409227554884324n, 7], run: "a" })).toBe(
      '{"psm_id":3619665049874577583,"ids":[-2767409227554884324,7],"run":"a"}'
    );
    expect(toJson([1n], 2)).toBe("[\n  1\n]");
  });
});
