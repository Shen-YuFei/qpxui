// The annotated spectrum's ECharts option (PRIDE USI viewer style): sticks
// coloured by ion type with labels at their tips, an optional reference
// spectrum mirrored below, and the fragment mass errors underneath.
import { escapeHtml, sliderStyle, tooltipStyle, type ChartTheme } from "./charts";
import type { Peak, Tolerance } from "./fragments";
import type { MirrorSpectrum } from "./mirror";

export const B_COLOR = "#2a78d6";
export const Y_COLOR = "#e34948";

/** A matched peak's colour: b blue, y red, lighter with a neutral loss. */
export function ionColor(p: Peak): string {
  if (!p.ion) return "";
  const c = p.ion.type === "b" ? B_COLOR : Y_COLOR;
  return p.ion.loss ? `${c}99` : c;
}

export interface SpectrumChart {
  peaks: Peak[];
  /** Reference spectrum, drawn downwards. */
  mirror: MirrorSpectrum | null;
  /** The m/z axis reaches at least the precursor. */
  precursorMz: number;
  showLabels: boolean;
  /** Unit of the mass errors, and the error the error axis spans at least. */
  unit: Tolerance["unit"];
  tolerance: number;
  /** Axis text, grid lines, unmatched peaks, the tooltip and the zoom slider. */
  colors: ChartTheme;
}

export function spectrumOption(c: SpectrumChart) {
  const { dim, grid, axis, other: grey } = c.colors;
  const mi = c.peaks.reduce((m, p) => Math.max(m, p.intensity), 0) || 1;
  const pts = c.peaks.map((p, i) => ({ p, i, rel: (p.intensity / mi) * 100 }));
  const mir = c.mirror?.peaks ?? [];
  const mmi = mir.reduce((m, p) => Math.max(m, p.intensity), 0) || 1;
  const mpts = mir.map((p, i) => ({ p, i, rel: -(p.intensity / mmi) * 100 }));
  const hasMirror = mpts.length > 0;
  const xMax = [...c.peaks, ...mir].reduce((m, p) => Math.max(m, p.mz), c.precursorMz) * 1.04;

  const stick = (name: string, color: string, sel: typeof pts) => ({
    name,
    type: "custom",
    clip: true,
    xAxisIndex: 0,
    yAxisIndex: 0,
    silent: true,
    data: sel.map((x) => [x.p.mz, x.rel]),
    renderItem: (_: any, api: any) => {
      const a = api.coord([api.value(0), 0]);
      const b = api.coord([api.value(0), api.value(1)]);
      return { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: color, lineWidth: 1.3 } };
    },
  });
  const un = pts.filter((x) => !x.p.ion);
  const bb = pts.filter((x) => x.p.ion?.type === "b");
  const yy = pts.filter((x) => x.p.ion?.type === "y");
  const mun = mpts.filter((x) => !x.p.ion);
  const mbb = mpts.filter((x) => x.p.ion?.type === "b");
  const myy = mpts.filter((x) => x.p.ion?.type === "y");
  const mtips = [...mpts].sort((a, b) => a.rel - b.rel).map((x) => ({
    value: [x.p.mz, x.rel],
    idx: x.i,
    mirror: true,
    label: x.p.ion && c.showLabels ? { show: true, formatter: x.p.ion.label, color: ionColor(x.p), position: "bottom" } : { show: false },
  }));
  // Invisible hover targets + labels at the stick tips, most intense first so
  // they win when labels overlap.
  const tips = [...pts].sort((a, b) => b.rel - a.rel).map((x) => ({
    value: [x.p.mz, x.rel],
    idx: x.i,
    label: x.p.ion && c.showLabels ? { show: true, formatter: x.p.ion.label, color: ionColor(x.p) } : { show: false },
  }));
  const errs = pts.filter((x) => x.p.ion && Number.isFinite(x.p.error)).map((x) => ({
    value: [x.p.mz, x.p.error],
    idx: x.i,
    itemStyle: { color: ionColor(x.p) },
  }));
  const errMax = errs.reduce((m, e) => Math.max(m, Math.abs(Number(e.value[1]))), c.tolerance) * 1.1;

  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: c.colors.font },
    tooltip: {
      ...tooltipStyle(c.colors),
      trigger: "item",
      formatter: (prm: any) => {
        const isM = !!prm.data?.mirror;
        const pk = isM ? mir[prm.data?.idx] : c.peaks[prm.data?.idx];
        if (!pk) return "";
        const lines = [`m/z <b>${pk.mz.toFixed(4)}</b>`, `intensity ${pk.intensity.toExponential(3)} (${((pk.intensity / (isM ? mmi : mi)) * 100).toFixed(1)}%)`];
        if (isM) lines.unshift(`<span style="opacity:.7">${escapeHtml(c.mirror?.label ?? "mirror")}</span>`);
        if (pk.ion) {
          lines.unshift(`<b style="color:${ionColor(pk)}">${escapeHtml(pk.ion.label)}</b>`);
          if (Number.isFinite(pk.ion.mz)) lines.push(`theoretical ${pk.ion.mz.toFixed(4)}`);
          if (Number.isFinite(pk.error)) lines.push(`error ${pk.error!.toFixed(c.unit === "ppm" ? 2 : 4)} ${c.unit}`);
        }
        return lines.join("<br/>");
      },
    },
    graphic: hasMirror
      ? [
          { type: "text", right: 24, top: 24, style: { text: "PSM", fill: dim, fontSize: 11 } },
          { type: "text", right: 24, top: "57%", style: { text: c.mirror?.label ?? "", fill: dim, fontSize: 11, align: "right" } },
        ]
      : [],
    grid: [
      { left: 56, right: 18, top: 22, height: "62%" },
      { left: 56, right: 18, top: "76%", bottom: 58 },
    ],
    xAxis: [
      { type: "value", min: 0, max: Math.ceil(xMax), gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: axis } }, splitLine: { show: false } },
      { type: "value", min: 0, max: Math.ceil(xMax), gridIndex: 1, name: "m/z", nameLocation: "middle", nameGap: 22, nameTextStyle: { color: dim }, axisLabel: { color: dim, showMaxLabel: false }, axisLine: { lineStyle: { color: axis } }, splitLine: { show: false } },
    ],
    yAxis: [
      {
        type: "value", min: hasMirror ? -125 : 0, max: hasMirror ? 125 : 112, interval: hasMirror ? 25 : undefined, gridIndex: 0,
        name: "Relative intensity (%)", nameLocation: "middle", nameGap: 38, nameTextStyle: { color: dim },
        axisLabel: { color: dim, formatter: (v: number) => (Math.abs(v) > 100 || (hasMirror && v % 50 !== 0) ? "" : String(Math.abs(v))) },
        splitLine: { lineStyle: { color: grid } },
      },
      { type: "value", gridIndex: 1, min: -errMax, max: errMax, name: c.unit, nameLocation: "middle", nameGap: 38, nameTextStyle: { color: dim }, axisLabel: { color: dim, formatter: (v: number) => (Math.abs(v) < 1e-9 ? "0" : v.toPrecision(2)) }, splitNumber: 2, splitLine: { lineStyle: { color: grid } } },
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1], filterMode: "none" },
      { ...sliderStyle(c.colors), xAxisIndex: [0, 1], height: 12, bottom: 2, filterMode: "none", showDetail: false },
    ],
    series: [
      stick("unmatched", grey, un),
      stick("b", B_COLOR, bb),
      stick("y", Y_COLOR, yy),
      ...(hasMirror
        ? [
            stick("mirror unmatched", grey, mun),
            stick("mirror b", B_COLOR, mbb),
            stick("mirror y", Y_COLOR, myy),
            {
              name: "mirror peaks",
              type: "scatter",
              xAxisIndex: 0,
              yAxisIndex: 0,
              symbolSize: 7,
              itemStyle: { color: "rgba(0,0,0,0)" },
              emphasis: { scale: false, itemStyle: { color: dim } },
              label: { position: "bottom", fontSize: 10, distance: 2 },
              labelLayout: { hideOverlap: true },
              data: mtips,
              markLine: { silent: true, symbol: "none", lineStyle: { color: axis, width: 1 }, label: { show: false }, data: [{ yAxis: 0 }] },
            },
          ]
        : []),
      {
        name: "peaks",
        type: "scatter",
        xAxisIndex: 0,
        yAxisIndex: 0,
        symbolSize: 7,
        itemStyle: { color: "rgba(0,0,0,0)" },
        emphasis: { scale: false, itemStyle: { color: dim } },
        label: { position: "top", fontSize: 10, distance: 2 },
        labelLayout: { hideOverlap: true },
        data: tips,
      },
      {
        name: "error",
        type: "scatter",
        xAxisIndex: 1,
        yAxisIndex: 1,
        symbolSize: 5,
        data: errs,
        markLine: { silent: true, symbol: "none", lineStyle: { color: dim, type: "dashed", width: 1 }, label: { show: false }, data: [{ yAxis: 0 }] },
      },
    ],
  };
}
