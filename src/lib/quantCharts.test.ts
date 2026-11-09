import { describe, expect, it } from "vitest";
import { CATEGORICAL, type ChartTheme } from "./charts";
import type { QuantMatrix } from "./quant";
import {
  correlationChart,
  correlationCsv,
  distributionSpec,
  matrixCsv,
  pcaChart,
  pcaCsv,
  profileChart,
  profileCsv,
  proteinCountSpec,
  type SampleStyle,
} from "./quantCharts";

const theme: ChartTheme = {
  text: "#text", dim: "#dim", border: "#border", accent: "#accent", bg: "#ffffff", grid: "#grid", axis: "#axis",
  pooled: "#pooled", other: "#other", cat: CATEGORICAL, font: "font",
};
const samples = ["run_B1", "run_A1", "run_A2"];
const groupOf: Record<string, string> = { run_A1: "A", run_A2: "A", run_B1: "B" };

function style(groupBy = ""): SampleStyle {
  const colors: Record<string, string> = { A: "#a", B: "#b" };
  return {
    theme,
    short: (s) => s,
    groupBy,
    groups: groupBy ? ["A", "B"] : [],
    groupOf: (s) => (groupBy ? groupOf[s] : ""),
    groupColor: (g) => colors[g] ?? theme.pooled,
  };
}

describe("correlationChart", () => {
  it("lays the matrix out in the clustered order and floors the colour scale", () => {
    const r = [
      [1, 0.47, NaN],
      [0.47, 1, 0.9],
      [NaN, 0.9, 1],
    ];
    const o: any = correlationChart(samples, { r, ord: [2, 1, 0] }, theme, (s) => s);
    expect(o.xAxis.data).toEqual(["run_A2", "run_A1", "run_B1"]);
    expect(o.series[0].data.slice(0, 3)).toEqual([
      [0, 0, 1],
      [0, 1, 0.9],
      [0, 2, "-"],
    ]);
    expect(o.visualMap.min).toBe(0.45);
    expect(o.tooltip.formatter({ data: [0, 2, "-"] })).toBe("run_A2<br/>run_B1<br/>Pearson r <b>–</b>");
  });
});

describe("pcaChart", () => {
  const p = { scores: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], explained: [0.5, 0.25, 0.1], used: 10 };

  it("plots all samples as one series without a grouping", () => {
    const o: any = pcaChart(samples, p, 0, 2, style());
    expect(o.series.map((s: any) => s.name)).toEqual(["samples"]);
    expect(o.series[0].data).toEqual([[1, 3, "run_B1"], [4, 6, "run_A1"], [7, 9, "run_A2"]]);
    expect([o.xAxis.name, o.yAxis.name]).toEqual(["PC1 (50.0%)", "PC3 (10.0%)"]);
    expect(o.legend).toBeUndefined();
  });

  it("splits the samples into one coloured series per group", () => {
    const o: any = pcaChart(samples, p, 0, 1, style("condition"));
    expect(o.series.map((s: any) => [s.name, s.itemStyle.color, s.data.map((d: any) => d[2])])).toEqual([
      ["A", "#a", ["run_A1", "run_A2"]],
      ["B", "#b", ["run_B1"]],
    ]);
    expect(o.tooltip.formatter({ data: [4, 5, "run_A1"] })).toBe("<b>run_A1</b><br/>condition: A<br/>PC1 4.00 · PC2 5.00");
  });
});

describe("profileChart", () => {
  const row = new Float64Array([20, NaN, 24]);

  it("draws the protein per sample in order, a missing value as a gap", () => {
    const o: any = profileChart(samples, [1, 2, 0], row, style());
    expect(o.xAxis.data).toEqual(["run_A1", "run_A2", "run_B1"]);
    expect(o.series[0].data.map((d: any) => d.value)).toEqual([null, 24, 20]);
    expect(o.yAxis.min).toBe(19);
    expect(o.series[0].markLine).toBeUndefined();
    expect(o.tooltip.formatter([{ seriesType: "bar", dataIndex: 0, value: null }])).toBe(
      "<b>run_A1</b><br/>log2 abundance <b>not quantified</b>",
    );
  });

  it("marks each group's mean over its bars", () => {
    const o: any = profileChart(samples, [1, 2, 0], row, style("condition"));
    expect(o.series[0].markLine.data).toEqual([
      [{ coord: ["run_A1", 24], name: "A", lineStyle: { color: "#a", width: 2, type: "solid" } }, { coord: ["run_A2", 24] }],
      [{ coord: ["run_B1", 20], name: "B", lineStyle: { color: "#b", width: 2, type: "solid" } }, { coord: ["run_B1", 20] }],
    ]);
    expect(o.legend.data.map((d: any) => d.name)).toEqual(["A", "B"]);
    expect(o.series.slice(1).map((s: any) => s.name)).toEqual(["A", "B"]);
  });
});

describe("distribution and count charts", () => {
  const m: QuantMatrix = {
    samples: ["a", "b"],
    proteins: ["P1", "P2", "P3"],
    genes: [null, null, null],
    values: [Float64Array.from([1, NaN]), Float64Array.from([2, 5]), Float64Array.from([3, NaN])],
  };

  it("draws the quantiles of each column in order", () => {
    const spec = distributionSpec(m, [1, 0]);
    expect(spec.labels).toEqual(["b", "a"]);
    expect(spec.series[0].values).toEqual([[5, 5, 5, 5, 5], [1.1, 1.5, 2, 2.5, 2.9]]);
    expect(spec.hideLabels).toBe(false);
  });

  it("counts quantified proteins per column, coloured by group", () => {
    const plain = proteinCountSpec(m, [0, 1], "", () => "", () => "#x");
    expect(plain.series[0].values).toEqual([3, 1]);
    expect(plain.colors).toBeUndefined();
    const grouped = proteinCountSpec(m, [0, 1], "disease", (s) => (s === "a" ? "x" : "y"), (g) => `#${g}`);
    expect(grouped.colors).toEqual(["#x", "#y"]);
    expect(grouped.notes).toEqual(["disease: x", "disease: y"]);
  });
});

describe("quantification CSV", () => {
  it("writes the correlation matrix in the clustered order", () => {
    expect(correlationCsv(["a", "b"], { r: [[1, 0.5], [0.5, 1]], ord: [1, 0] })).toBe("sample,b,a\nb,1,0.5\na,0.5,1\n");
  });

  it("writes PCA scores with the group column when grouping", () => {
    const p = { scores: [[1, 2], [3, 4]], explained: [0.6, 0.3], used: 10 };
    expect(pcaCsv(["a", "b"], p, "", () => "")).toBe("sample,PC1,PC2\na,1,2\nb,3,4\n");
    expect(pcaCsv(["a", "b"], p, "sex", (s) => (s === "a" ? "F" : "M"))).toBe("sample,sex,PC1,PC2\na,F,1,2\nb,M,3,4\n");
  });

  it("writes one protein's profile with missing values empty", () => {
    expect(profileCsv(["a", "b"], [1, 0], Float64Array.from([1.5, NaN]), "", () => "")).toBe("sample,log2_abundance\nb,\na,1.5\n");
  });

  it("writes the matrix rounded to five decimals", () => {
    const m: QuantMatrix = { samples: ["a", "b"], proteins: ["P1"], genes: ["G"], values: [Float64Array.from([1.123456789, NaN])] };
    expect(matrixCsv(m)).toBe("anchor_protein,gene,a,b\nP1,G,1.12346,\n");
  });
});
