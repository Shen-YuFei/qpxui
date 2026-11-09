// ECharts options for a peptidoform's profile on the Peptidoforms tab: its
// intensity per sample, the intensity distribution per sample group and its
// retention time in each run.
import { commonPrefix, escapeHtml, legendStyle, seriesColor, sliderStyle, tooltipStyle, type ChartTheme, type GroupStyle } from "./charts";
import { quantile } from "./quant";

/** One feature (or PSM) of the peptidoform. */
export interface Feature {
  fid: number;
  run: string;
  charge: number | null;
  rt: number | null;
  rtLo: number | null;
  rtHi: number | null;
  pep: number | null;
}

/** log2 intensity per sample, summed over `n` features. */
export type PerSample = Map<string, { log2: number; n: number }>;

export interface ProfileStyle extends GroupStyle {
  /** The intensity axis: log2, or log2 minus the sample median. */
  yLabel: string;
}

/** Axis label: drop the shared prefix, then keep the distinctive end of long names. */
export const shorten = (p: string) => (s: string) => {
  const rest = p ? s.slice(p.length) : s;
  return rest.length > 16 ? `…${rest.slice(-15)}` : p ? `…${rest}` : rest;
};

function categoryAxis(labels: string[], t: ChartTheme) {
  const p = commonPrefix(labels);
  return {
    type: "category",
    data: labels,
    axisLabel: { show: labels.length <= 80, color: t.dim, rotate: labels.length > 8 ? 45 : 0, fontSize: 10, formatter: shorten(p), hideOverlap: true },
    axisLine: { lineStyle: { color: t.axis } },
  };
}
function valueAxis(name: string, t: ChartTheme) {
  return {
    type: "value",
    scale: true,
    name,
    nameLocation: "middle",
    nameGap: 36,
    nameTextStyle: { color: t.dim },
    axisLabel: { color: t.dim },
    splitLine: { lineStyle: { color: t.grid } },
  };
}
function groupLegend(st: ProfileStyle) {
  const t = st.theme;
  return st.groupBy
    ? { ...legendStyle(t), data: st.groups.map((g) => ({ name: g, itemStyle: { color: st.groupColor(g) } })) }
    : undefined;
}

/** The peptidoform's log2 intensity in each sample (or run) of `labels`;
 * `evidence` names what was summed ("features" or "PSMs"). */
export function sampleChart(labels: string[], perSample: PerSample, evidence: string, st: ProfileStyle) {
  const data = labels.map((s) => {
    const v = perSample.get(s);
    return { value: v && Number.isFinite(v.log2) ? +v.log2.toFixed(4) : null, itemStyle: { color: st.groupColor(st.groupOf(s)) } };
  });
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: st.theme.font },
    legend: groupLegend(st),
    tooltip: {
      ...tooltipStyle(st.theme),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: `${st.theme.axis}33` } },
      formatter: (ps: any) => {
        const p = (Array.isArray(ps) ? ps : [ps]).find((x: any) => x.seriesType === "bar");
        if (!p) return "";
        const s = labels[p.dataIndex];
        const v = perSample.get(s);
        const g = st.groupBy ? `<br/>${escapeHtml(st.groupBy)}: ${escapeHtml(st.groupOf(s))}` : "";
        const body = v ? `${st.yLabel} <b>${v.log2.toFixed(2)}</b><br/>${v.n} ${evidence} summed` : "not quantified";
        return `<b>${escapeHtml(s)}</b>${g}<br/>${body}`;
      },
    },
    grid: { left: 26, right: 18, top: st.groupBy ? 32 : 14, bottom: 4, containLabel: true },
    dataZoom: labels.length > 80 ? [{ type: "inside" }, { ...sliderStyle(st.theme), bottom: 0 }] : undefined,
    xAxis: categoryAxis(labels, st.theme),
    yAxis: valueAxis(st.yLabel, st.theme),
    series: [
      { name: "intensity", type: "bar", data, barMaxWidth: 24, itemStyle: { borderRadius: [4, 4, 0, 0] } },
      ...st.groups.map((g) => ({ name: g, type: "line", data: [], itemStyle: { color: st.groupColor(g) } })),
    ],
  };
}

/** Box (5–95% whiskers) plus the individual samples, per group; ungrouped,
 * one box of all `unit`. */
export function distributionChart(labels: string[], perSample: PerSample, unit: "samples" | "runs", st: ProfileStyle) {
  const t = st.theme;
  const cats = st.groupBy ? st.groups : [`all ${unit}`];
  const valuesOf = (g: string) =>
    labels
      .filter((s) => !st.groupBy || st.groupOf(s) === g)
      .map((s) => ({ s, v: perSample.get(s)?.log2 }))
      .filter((x): x is { s: string; v: number } => x.v != null && Number.isFinite(x.v));
  const boxes = cats.map((g) => {
    const xs = valuesOf(g).map((x) => x.v).sort((a, b) => a - b);
    return xs.length ? [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => +quantile(xs, q).toFixed(4)) : [];
  });
  const points = cats.flatMap((g, k) =>
    valuesOf(g).map((x, i, arr) => ({
      value: [k + ((i / Math.max(1, arr.length - 1)) - 0.5) * 0.5, +x.v.toFixed(4), x.s],
      itemStyle: { color: st.groupColor(st.groupBy ? g : "") },
    }))
  );
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: t.font },
    tooltip: {
      ...tooltipStyle(t),
      formatter: (p: any) => {
        if (p.seriesType === "boxplot") {
          const q = (p.value as number[]).slice(-5);
          return `<b>${escapeHtml(cats[p.dataIndex])}</b><br/>` + ["5%", "25%", "median", "75%", "95%"].map((n, k) => `${n}: <b>${Number(q[k]).toFixed(2)}</b>`).join("<br/>");
        }
        return `<b>${escapeHtml(p.value[2])}</b><br/>${st.yLabel} <b>${Number(p.value[1]).toFixed(2)}</b>`;
      },
    },
    grid: { left: 26, right: 18, top: 14, bottom: 4, containLabel: true },
    xAxis: {
      ...categoryAxis(cats, t),
      axisLabel: {
        color: t.dim,
        fontSize: 10,
        interval: 0,
        rotate: cats.length > 4 ? 30 : 0,
        width: cats.length > 4 ? 140 : Math.max(60, 420 / cats.length),
        overflow: "break",
      },
    },
    yAxis: valueAxis(st.yLabel, t),
    series: [
      { name: "distribution", type: "boxplot", data: boxes, itemStyle: { color: `${t.pooled}1f`, borderColor: t.dim } },
      { name: "samples", type: "scatter", symbolSize: 7, data: points, xAxisIndex: 0, z: 3 },
    ],
  };
}

/** Apex RT per run, one series per charge, with the elution window as a bar;
 * a dashed line marks the median RT `med`. */
export function retentionChart(features: Feature[], runs: string[], charges: (number | null)[], med: number | null, t: ChartTheme) {
  const withRt = features.filter((f) => f.rt != null);
  const labels = runs;
  const idx = new Map(labels.map((r, i) => [r, i]));
  const ranges = withRt.filter((f) => f.rtLo != null && f.rtHi != null);
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: t.font },
    legend: charges.length > 1 ? legendStyle(t) : undefined,
    tooltip: {
      ...tooltipStyle(t),
      formatter: (p: any) => {
        const f: Feature | undefined = p.data?.f;
        if (!f) return "";
        const win = f.rtLo != null && f.rtHi != null ? `<br/>window ${f.rtLo.toFixed(2)}–${f.rtHi.toFixed(2)} min` : "";
        const pep = f.pep != null ? `<br/>PEP ${f.pep.toExponential(1)}` : "";
        return `<b>${escapeHtml(f.run)}</b><br/>z ${f.charge ?? "?"} · RT <b>${f.rt!.toFixed(2)}</b> min${win}${pep}`;
      },
    },
    grid: { left: 26, right: 18, top: charges.length > 1 ? 32 : 14, bottom: 4, containLabel: true },
    dataZoom: labels.length > 80 ? [{ type: "inside" }, { ...sliderStyle(t), bottom: 0 }] : undefined,
    xAxis: categoryAxis(labels, t),
    yAxis: valueAxis("RT (min)", t),
    series: [
      ...(ranges.length
        ? [{
            name: "window",
            type: "custom",
            silent: true,
            renderItem: (_: any, api: any) => {
              const a = api.coord([api.value(0), api.value(1)]);
              const b = api.coord([api.value(0), api.value(2)]);
              return { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: t.dim, lineWidth: 2, opacity: 0.5 } };
            },
            data: ranges.map((f) => [idx.get(f.run), f.rtLo, f.rtHi]),
          }]
        : []),
      ...charges.map((z, k) => ({
        name: z == null ? "z ?" : `z ${z}`,
        type: "scatter",
        symbolSize: 8,
        itemStyle: { color: seriesColor(charges, z, t), borderColor: t.bg, borderWidth: 2 },
        data: withRt.filter((f) => f.charge === z).map((f) => ({ value: [idx.get(f.run), +f.rt!.toFixed(3)], f })),
        markLine:
          k === 0 && med != null
            ? { silent: true, symbol: "none", label: { color: t.dim, position: "insideEndTop", formatter: `median ${med.toFixed(2)}` }, lineStyle: { color: t.dim, type: "dashed" }, data: [{ yAxis: med }] }
            : undefined,
      })),
    ],
  };
}
