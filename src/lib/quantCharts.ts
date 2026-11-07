// ECharts options for the Quantification tab: the sample correlation
// heatmap, the PCA scores and one protein's abundance across samples.
import { escapeHtml, type ChartTheme, type GroupStyle } from "./charts";
import type { Pca } from "./quant";

/** How the charts name and colour samples. */
export interface SampleStyle extends GroupStyle {
  /** A sample's name without the prefix all samples share. */
  short: (sample: string) => string;
}

/** Pearson r between samples, in the clustered order `ord`. */
export function correlationChart(samples: string[], c: { r: number[][]; ord: number[] }, t: ChartTheme, short: (sample: string) => string) {
  const labels = c.ord.map((j) => samples[j]);
  const data: [number, number, number | string][] = [];
  let lo = 1;
  c.ord.forEach((a, x) =>
    c.ord.forEach((b, y) => {
      const v = c.r[a][b];
      if (Number.isFinite(v)) lo = Math.min(lo, v);
      data.push([x, y, Number.isFinite(v) ? +v.toFixed(4) : "-"]);
    })
  );
  const min = Math.max(-1, Math.floor(lo * 20) / 20);
  const showLabels = labels.length <= 40;
  const axis = (pos: "x" | "y") => ({
    type: "category",
    data: labels,
    axisLabel: { show: showLabels, color: t.dim, fontSize: 10, rotate: pos === "x" ? 50 : 0, formatter: short },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: t.border } },
    splitArea: { show: false },
  });
  return {
    animation: false,
    backgroundColor: "transparent",
    tooltip: {
      confine: true,
      formatter: (p: any) => {
        const [x, y, v] = p.data;
        return `${escapeHtml(labels[x])}<br/>${escapeHtml(labels[y])}<br/>Pearson r <b>${typeof v === "number" ? v.toFixed(3) : "–"}</b>`;
      },
    },
    grid: { left: 8, right: 70, top: 10, bottom: 8, containLabel: true },
    xAxis: axis("x"),
    yAxis: { ...axis("y"), inverse: true },
    visualMap: {
      min,
      max: 1,
      calculable: true,
      orient: "vertical",
      right: 4,
      top: "middle",
      itemHeight: 160,
      precision: 2,
      textStyle: { color: t.dim },
      inRange: { color: ["#313695", "#4575b4", "#74add1", "#abd9e9", "#ffffbf", "#fdae61", "#f46d43", "#d73027"] },
    },
    series: [{ type: "heatmap", data, progressive: 0, emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1 } } }],
  };
}

/** Sample scores on principal components `cx` and `cy`. */
export function pcaChart(samples: string[], p: Pca, cx: number, cy: number, st: SampleStyle) {
  const t = st.theme;
  const gs = st.groupBy ? st.groups : [""];
  const labelsOn = samples.length <= 40;
  const series = gs.map((g) => ({
    name: g || "samples",
    type: "scatter",
    symbolSize: 11,
    itemStyle: { color: st.groupColor(g), borderColor: t.bg, borderWidth: 1 },
    label: { show: labelsOn, position: "right", fontSize: 10, color: t.dim, formatter: (d: any) => st.short(d.data[2]) },
    labelLayout: { hideOverlap: true },
    data: samples.map((s, j) => (st.groupOf(s) === g || !st.groupBy ? [p.scores[j][cx], p.scores[j][cy], s] : null)).filter(Boolean),
  }));
  const pct = (c: number) => `PC${c + 1} (${((p.explained[c] ?? 0) * 100).toFixed(1)}%)`;
  const axis = (name: string) => ({
    type: "value",
    scale: true,
    name,
    nameLocation: "middle",
    nameGap: 28,
    nameTextStyle: { color: t.dim },
    axisLabel: { color: t.dim },
    splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
  });
  return {
    animation: false,
    backgroundColor: "transparent",
    legend: st.groupBy ? { top: 0, type: "scroll", textStyle: { color: t.dim }, pageTextStyle: { color: t.dim } } : undefined,
    tooltip: {
      confine: true,
      formatter: (prm: any) => {
        const [x, y, s] = prm.data;
        const g = st.groupBy ? `<br/>${escapeHtml(st.groupBy)}: ${escapeHtml(st.groupOf(s))}` : "";
        return `<b>${escapeHtml(s)}</b>${g}<br/>PC${cx + 1} ${x.toFixed(2)} · PC${cy + 1} ${y.toFixed(2)}`;
      },
    },
    grid: { left: 34, right: 24, top: st.groupBy ? 34 : 14, bottom: 30, containLabel: true },
    xAxis: axis(pct(cx)),
    yAxis: { ...axis(pct(cy)), nameGap: 36, nameRotate: 90 },
    series,
  };
}

/** One protein's log2 abundance per sample (`row`), samples in `order`;
 * with a grouping, each group's mean is drawn over its bars. */
export function profileChart(samples: string[], order: number[], row: Float64Array, st: SampleStyle) {
  const t = st.theme;
  const labels = order.map((j) => samples[j]);
  const data = order.map((j) => ({
    value: Number.isFinite(row[j]) ? +row[j].toFixed(4) : null,
    itemStyle: { color: st.groupColor(st.groupOf(samples[j])) },
  }));
  // Mean per group, drawn as a line segment over that group's bars.
  const marks: any[] = [];
  if (st.groupBy) {
    let start = 0;
    for (let k = 1; k <= labels.length; k++) {
      if (k < labels.length && st.groupOf(labels[k]) === st.groupOf(labels[start])) continue;
      const xs = order.slice(start, k).map((j) => row[j]).filter(Number.isFinite);
      if (xs.length) {
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
        marks.push([
          { coord: [labels[start], mean], name: st.groupOf(labels[start]), lineStyle: { color: st.groupColor(st.groupOf(labels[start])), width: 2, type: "solid" } },
          { coord: [labels[k - 1], mean] },
        ]);
      }
      start = k;
    }
  }
  const finite = [...row].filter(Number.isFinite);
  return {
    animation: false,
    backgroundColor: "transparent",
    legend: st.groupBy
      ? { top: 0, type: "scroll", data: st.groups.map((g) => ({ name: g, itemStyle: { color: st.groupColor(g) } })), textStyle: { color: t.dim }, pageTextStyle: { color: t.dim } }
      : undefined,
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      formatter: (ps: any) => {
        const p = (Array.isArray(ps) ? ps : [ps]).find((x: any) => x.seriesType === "bar");
        if (!p) return "";
        const s = labels[p.dataIndex];
        const v = p.value;
        const g = st.groupBy ? `<br/>${escapeHtml(st.groupBy)}: ${escapeHtml(st.groupOf(s))}` : "";
        return `<b>${escapeHtml(s)}</b>${g}<br/>log2 abundance <b>${v == null ? "not quantified" : Number(v).toFixed(2)}</b>`;
      },
    },
    grid: { left: 26, right: 18, top: st.groupBy ? 32 : 14, bottom: labels.length > 60 ? 8 : 4, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { show: labels.length <= 60, color: t.dim, rotate: labels.length > 10 ? 45 : 0, fontSize: 10, formatter: st.short, hideOverlap: true },
      axisLine: { lineStyle: { color: t.border } },
    },
    yAxis: {
      type: "value",
      name: "log2 abundance",
      nameLocation: "middle",
      nameGap: 34,
      nameTextStyle: { color: t.dim },
      min: finite.length ? Math.floor(Math.min(...finite) - 1) : undefined,
      axisLabel: { color: t.dim },
      splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
    },
    series: [
      {
        name: "abundance",
        type: "bar",
        data,
        barMaxWidth: 26,
        markLine: marks.length ? { silent: true, symbol: "none", label: { show: false }, data: marks } : undefined,
      },
      // Legend entries for the groups (bars are coloured per item).
      ...st.groups.map((g) => ({ name: g, type: "line", data: [], itemStyle: { color: st.groupColor(g) } })),
    ],
  };
}
