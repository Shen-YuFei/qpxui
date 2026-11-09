import { describe, expect, it } from "vitest";
import {
  averageLinkageOrder,
  correlation,
  findProteins,
  groupedOrder,
  groupingColumns,
  medianNormalize,
  pca,
  presence,
  proteinSummaries,
  quantile,
  sampleGroup,
  withoutFlagged,
  type QuantMatrix,
} from "./quant";

const rows = (xs: number[][]) => xs.map((r) => Float64Array.from(r));

describe("quantile", () => {
  it("interpolates between neighbours", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe("medianNormalize", () => {
  it("aligns every sample median to the median of medians", () => {
    const m: QuantMatrix = { samples: ["a", "b"], proteins: ["p1", "p2", "p3"], genes: [null, null, null], values: rows([[1, 11], [2, 12], [3, NaN]]) };
    const out = medianNormalize(m);
    // Medians 2 and 11.5; their median 6.75 becomes every sample's median.
    expect(Array.from(out.values[0])).toEqual([5.75, 6.25]);
    expect(Array.from(out.values[1])).toEqual([6.75, 7.25]);
    expect(out.values[2][1]).toBeNaN();
  });
});

describe("presence", () => {
  it("counts finite values", () => {
    expect(presence(Float64Array.from([1, NaN, 3]))).toBe(2);
  });
});

describe("correlation", () => {
  it("is 1 on the diagonal and needs three shared proteins", () => {
    const r = correlation(rows([[1, 2, 1], [2, 4, NaN], [3, 6, 5], [4, 8, NaN]]), 3);
    expect(r[0][0]).toBe(1);
    expect(r[0][1]).toBeCloseTo(1);
    expect(r[0][2]).toBeNaN();
  });
});

describe("averageLinkageOrder", () => {
  it("keeps close samples next to each other", () => {
    const d = [
      [0, 9, 1, 9],
      [9, 0, 9, 1],
      [1, 9, 0, 9],
      [9, 1, 9, 0],
    ];
    const order = averageLinkageOrder(d);
    expect(order.sort()).toEqual([0, 1, 2, 3]);
    const pos = (i: number) => averageLinkageOrder(d).indexOf(i);
    expect(Math.abs(pos(0) - pos(2))).toBe(1);
    expect(Math.abs(pos(1) - pos(3))).toBe(1);
  });
});

describe("pca", () => {
  it("separates two groups on the first component", () => {
    const data = rows([
      [1, 1.1, 5, 5.2],
      [2, 2.1, 7, 7.1],
      [0, 0.2, 3, 3.1],
      [4, 4.1, 1, 1.2],
    ]);
    const p = pca(data, 4, 2);
    const pc1 = p.scores.map((s) => s[0]);
    expect(Math.sign(pc1[0])).toBe(Math.sign(pc1[1]));
    expect(Math.sign(pc1[2])).toBe(Math.sign(pc1[3]));
    expect(Math.sign(pc1[0])).not.toBe(Math.sign(pc1[2]));
    expect(p.explained[0]).toBeGreaterThan(p.explained[1]);
    expect(p.used).toBe(4);
  });
});

describe("groupingColumns", () => {
  it("keeps attributes with 2..12 groups, preferred ones first", () => {
    const meta = new Map<string, Record<string, unknown>>([
      ["s1", { sample_accession: "s1", sex: "F", disease: "x", batch: "1", donor: "d1" }],
      ["s2", { sample_accession: "s2", sex: "M", disease: "y", batch: "1", donor: "d2" }],
      ["s3", { sample_accession: "s3", sex: "F", disease: "x", batch: "2", donor: "d3" }],
    ]);
    expect(groupingColumns(["s1", "s2", "s3"], meta)).toEqual(["disease", "sex", "batch"]);
  });
});

describe("sampleGroup", () => {
  it("reads the sample's attribute, naming a missing value", () => {
    const meta = new Map<string, Record<string, any>>([["s1", { condition: "tumour", batch: 2 }], ["s2", { condition: "" }]]);
    expect(sampleGroup(meta, "condition", "s1")).toBe("tumour");
    expect(sampleGroup(meta, "batch", "s1")).toBe("2");
    expect(sampleGroup(meta, "condition", "s2")).toBe("not available");
    expect(sampleGroup(meta, "condition", "s3")).toBe("not available");
    expect(sampleGroup(meta, "", "s1")).toBe("");
  });
});

describe("protein list", () => {
  const m: QuantMatrix = {
    samples: ["s1", "s2", "s3"],
    proteins: ["P1", "CON__P2", "P3"],
    genes: ["ALB", null, "GAPDH"],
    values: rows([[20, 22, NaN], [25, 25, 25], [10, NaN, NaN]]),
  };

  it("drops flagged proteins", () => {
    const out = withoutFlagged(m, Uint8Array.from([0, 1, 0]));
    expect(out.proteins).toEqual(["P1", "P3"]);
    expect(out.genes).toEqual(["ALB", "GAPDH"]);
    expect(out.values.map((r) => r[0])).toEqual([20, 10]);
    expect(out.samples).toBe(m.samples);
  });

  it("summarises each protein's quantified values", () => {
    const [p1, p2, p3] = proteinSummaries(m);
    expect(p1).toEqual({ protein: "P1", gene: "ALB", n: 2, mean: 21, sd: Math.SQRT2 });
    expect(p2.sd).toBe(0);
    expect(p3).toEqual({ protein: "P3", gene: "GAPDH", n: 1, mean: 10, sd: null });
  });

  it("finds proteins by accession or gene, most quantified first", () => {
    const all = proteinSummaries(m);
    expect(findProteins(all, "").map((r) => r.protein)).toEqual(["CON__P2", "P1", "P3"]);
    expect(findProteins(all, " gapdh ").map((r) => r.protein)).toEqual(["P3"]);
    expect(findProteins(all, "p").map((r) => r.protein)).toEqual(["CON__P2", "P1", "P3"]);
  });

  it("orders columns by group rank, then name", () => {
    const group: Record<string, string> = { "S-10": "a", "S-2": "a", "S-1": "b" };
    expect(groupedOrder(["S-1", "S-10", "S-2"], (s) => group[s], (g) => (g === "b" ? 0 : 1))).toEqual([0, 2, 1]);
  });
});
