import { describe, expect, it } from "vitest";
import { CATEGORICAL, type ChartTheme } from "./charts";
import { distributionChart, retentionChart, sampleChart, shorten, type Feature, type PerSample, type ProfileStyle } from "./peptidoformCharts";

const theme: ChartTheme = {
  text: "#text", dim: "#dim", border: "#border", accent: "#accent", bg: "#bg", grid: "#grid", axis: "#axis",
  pooled: "#pooled", other: "#other", cat: CATEGORICAL, font: "font",
};
const groupOf: Record<string, string> = { s1: "A", s2: "A", s3: "B" };

function style(groupBy = ""): ProfileStyle {
  const colors: Record<string, string> = { A: "#a", B: "#b" };
  return {
    theme,
    groupBy,
    groups: groupBy ? ["A", "B"] : [],
    groupOf: (s) => (groupBy ? groupOf[s] : ""),
    groupColor: (g) => colors[g] ?? theme.pooled,
    yLabel: "log2 intensity",
  };
}

describe("shorten", () => {
  it("drops the shared prefix and keeps the end of long names", () => {
    expect(shorten("")("s1")).toBe("s1");
    expect(shorten("UM_F_")("UM_F_01")).toBe("…01");
    expect(shorten("")("a_very_long_run_name_01")).toBe("…ong_run_name_01");
  });
});

describe("sampleChart", () => {
  const perSample: PerSample = new Map([
    ["s1", { log2: 20.123456, n: 2 }],
    ["s3", { log2: 22, n: 1 }],
  ]);

  it("draws one bar per sample, a missing sample as a gap", () => {
    const o: any = sampleChart(["s1", "s2", "s3"], perSample, "features", style());
    expect(o.series.map((s: any) => s.name)).toEqual(["intensity"]);
    expect(o.series[0].data).toEqual([
      { value: 20.1235, itemStyle: { color: "#pooled" } },
      { value: null, itemStyle: { color: "#pooled" } },
      { value: 22, itemStyle: { color: "#pooled" } },
    ]);
    expect(o.legend).toBeUndefined();
    expect(o.dataZoom).toBeUndefined();
    expect(o.yAxis.name).toBe("log2 intensity");
    const tip = (i: number) => o.tooltip.formatter([{ seriesType: "bar", dataIndex: i }]);
    expect(tip(0)).toBe("<b>s1</b><br/>log2 intensity <b>20.12</b><br/>2 features summed");
    expect(tip(1)).toBe("<b>s2</b><br/>not quantified");
  });

  it("colours the bars by group with a legend entry per group", () => {
    const o: any = sampleChart(["s1", "s2", "s3"], perSample, "PSMs", style("condition"));
    expect(o.series[0].data.map((d: any) => d.itemStyle.color)).toEqual(["#a", "#a", "#b"]);
    expect(o.series.slice(1).map((s: any) => [s.name, s.itemStyle.color])).toEqual([["A", "#a"], ["B", "#b"]]);
    expect(o.legend.data.map((d: any) => d.name)).toEqual(["A", "B"]);
    expect(o.tooltip.formatter([{ seriesType: "bar", dataIndex: 2 }])).toBe(
      "<b>s3</b><br/>condition: B<br/>log2 intensity <b>22.00</b><br/>1 PSMs summed",
    );
  });

  it("adds a zoom bar past 80 samples", () => {
    const many = Array.from({ length: 81 }, (_, i) => `s${i}`);
    expect((sampleChart(many, perSample, "features", style()) as any).dataZoom).toHaveLength(2);
  });
});

describe("distributionChart", () => {
  const perSample: PerSample = new Map([
    ["s1", { log2: 1, n: 1 }],
    ["s2", { log2: 3, n: 1 }],
    ["s3", { log2: 5, n: 1 }],
    ["s4", { log2: NaN, n: 1 }],
  ]);
  const labels = ["s1", "s2", "s3", "s4"];

  it("draws one box of all samples when not grouping, missing values left out", () => {
    const o: any = distributionChart(labels, perSample, "runs", style());
    expect(o.xAxis.data).toEqual(["all runs"]);
    expect(o.series[0].data).toEqual([[1.2, 2, 3, 4, 4.8]]);
    expect(o.series[1].data.map((d: any) => d.value)).toEqual([[-0.25, 1, "s1"], [0, 3, "s2"], [0.25, 5, "s3"]]);
    expect(o.tooltip.formatter({ seriesType: "boxplot", dataIndex: 0, value: [0, 1.2, 2, 3, 4, 4.8] })).toBe(
      "<b>all runs</b><br/>5%: <b>1.20</b><br/>25%: <b>2.00</b><br/>median: <b>3.00</b><br/>75%: <b>4.00</b><br/>95%: <b>4.80</b>",
    );
    expect(o.tooltip.formatter({ seriesType: "scatter", value: [0, 3, "s2"] })).toBe("<b>s2</b><br/>log2 intensity <b>3.00</b>");
  });

  it("draws a box per group with its samples in the group's colour", () => {
    const o: any = distributionChart(labels.slice(0, 3), perSample, "samples", style("condition"));
    expect(o.xAxis.data).toEqual(["A", "B"]);
    expect(o.series[0].data).toEqual([[1.1, 1.5, 2, 2.5, 2.9], [5, 5, 5, 5, 5]]);
    expect(o.series[1].data.map((d: any) => [d.value[2], d.itemStyle.color])).toEqual([["s1", "#a"], ["s2", "#a"], ["s3", "#b"]]);
  });
});

describe("retentionChart", () => {
  const f = (run: string, charge: number | null, rt: number | null, win?: [number, number], pep: number | null = null): Feature => ({
    fid: 0,
    run,
    charge,
    rt,
    rtLo: win?.[0] ?? null,
    rtHi: win?.[1] ?? null,
    pep,
  });

  it("plots the apex per run and charge, the elution windows and the median", () => {
    const features = [f("r1", 2, 10, [9.5, 10.5], 0.001), f("r2", 3, 11), f("r2", 2, null)];
    const o: any = retentionChart(features, ["r1", "r2", "r3"], [2, 3], 10.5, theme);
    expect(o.series.map((s: any) => s.name)).toEqual(["window", "z 2", "z 3"]);
    expect(o.series[0].data).toEqual([[0, 9.5, 10.5]]);
    expect(o.series[1].data.map((d: any) => d.value)).toEqual([[0, 10]]);
    expect(o.series[2].data.map((d: any) => d.value)).toEqual([[1, 11]]);
    expect(o.series[1].markLine.data).toEqual([{ yAxis: 10.5 }]);
    expect(o.series[1].markLine.label.formatter).toBe("median 10.50");
    expect(o.series[2].markLine).toBeUndefined();
    expect(o.legend).toBeDefined();
    expect(o.tooltip.formatter({ data: { f: features[0] } })).toBe(
      "<b>r1</b><br/>z 2 · RT <b>10.00</b> min<br/>window 9.50–10.50 min<br/>PEP 1.0e-3",
    );
  });

  it("leaves out the windows, legend and median it has no data for", () => {
    const o: any = retentionChart([f("r1", null, 10)], ["r1"], [null], null, theme);
    expect(o.series.map((s: any) => s.name)).toEqual(["z ?"]);
    expect(o.series[0].markLine).toBeUndefined();
    expect(o.legend).toBeUndefined();
    expect(o.grid.top).toBe(14);
  });
});
