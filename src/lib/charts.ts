// Shared, theme-aware ECharts option builders for the report views. Importing
// this module registers the ECharts parts that every chart in the app uses.

import { use } from "echarts/core";
import { BarChart, BoxplotChart, CustomChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

use([
  BarChart, LineChart, BoxplotChart, ScatterChart, CustomChart, HeatmapChart, VisualMapComponent,
  GraphicComponent, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, TitleComponent,
  CanvasRenderer,
]);

export interface ChartSeries {
  name: string;
  /** One value per label; for `box` charts, [low, q1, median, q3, high]. */
  values: (number | number[] | null)[];
  color?: string;
}

export interface ChartSpec {
  kind: "bar" | "line" | "hbar" | "box";
  labels: string[];
  series: ChartSeries[];
  xName?: string;
  yName?: string;
  /** Hide category labels (e.g. hundreds of run names). */
  hideLabels?: boolean;
  /** Per-category bar colours (single-series bar/hbar). */
  colors?: string[];
  /** Stack multi-series bars. */
  stacked?: boolean;
  /** Force the value axis to start at 0 for line charts (counts). */
  zeroBased?: boolean;
  /** Extra tooltip line per category. */
  notes?: string[];
}

export interface ChartTheme {
  text: string;
  dim: string;
  border: string;
  accent: string;
  accent2: string;
  bg: string;
}

/** How grouped charts colour samples: by one sample attribute, or not at all. */
export interface GroupStyle {
  theme: ChartTheme;
  /** The sample attribute that colours the charts; "" for none. */
  groupBy: string;
  groups: string[];
  groupOf: (sample: string) => string;
  groupColor: (group: string) => string;
}

export function chartTheme(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    text: v("--text"),
    dim: v("--text-dim"),
    border: v("--border"),
    accent: v("--accent"),
    accent2: v("--accent-2"),
    bg: v("--bg-panel"),
  };
}

export const SERIES_COLORS = ["#22d3ee", "#818cf8", "#f472b6", "#fbbf24", "#34d399", "#f87171", "#a3e635", "#fb923c"];

/** The colour of `key` by its place in `keys`, cycling through the series
 * colours (a key not in `keys` takes the first). */
export function seriesColor<T>(keys: T[], key: T): string {
  return SERIES_COLORS[Math.max(0, keys.indexOf(key)) % SERIES_COLORS.length];
}

export function buildOption(spec: ChartSpec, t: ChartTheme): any {
  const horizontal = spec.kind === "hbar";
  const many = spec.labels.length > 40;
  const rotated = !horizontal && spec.labels.length > 10 && !spec.hideLabels;
  // Run names often share a long prefix ("UM_F_50cm_2019_04…"); drop it on the
  // axis (tooltips keep the full name).
  const prefix = commonPrefix(spec.labels);
  // Axis titles collide with rotated tick labels; the card subtitle says what the axis is.
  const showXName = !horizontal && !!spec.xName && !rotated;
  const category = {
    type: "category",
    data: spec.labels,
    name: showXName ? spec.xName : undefined,
    nameLocation: "middle",
    nameGap: spec.hideLabels ? 10 : 26,
    nameTextStyle: { color: t.dim },
    axisLine: { lineStyle: { color: t.border } },
    axisTick: { show: !spec.hideLabels },
    axisLabel: {
      show: !spec.hideLabels,
      color: t.dim,
      rotate: rotated ? 40 : 0,
      hideOverlap: true,
      formatter: (raw: string) => {
        const s = prefix ? `…${raw.slice(prefix.length)}` : raw;
        return s.length > 28 ? `${s.slice(0, 26)}…` : s;
      },
    },
    inverse: horizontal,
  };
  const value = {
    type: "value",
    // Distributions of medians/quantiles: zoom to the data instead of from 0.
    scale: spec.kind === "box" || spec.kind === "line" ? spec.zeroBased !== true : false,
    name: horizontal || spec.series.length > 1 ? undefined : spec.yName,
    nameTextStyle: { color: t.dim },
    axisLabel: { color: t.dim },
    splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
  };
  const series = spec.series.map((s, i) => {
    const color = s.color ?? (i === 0 ? t.accent : SERIES_COLORS[i % SERIES_COLORS.length]);
    if (spec.kind === "box") {
      return {
        name: s.name,
        type: "boxplot",
        data: s.values,
        itemStyle: { color: `${color}33`, borderColor: color },
      };
    }
    if (spec.kind === "line") {
      return {
        name: s.name,
        type: "line",
        data: s.values,
        showSymbol: spec.labels.length <= 60,
        lineStyle: { color },
        itemStyle: { color },
        areaStyle: spec.series.length === 1 ? { color: `${color}22` } : undefined,
      };
    }
    return {
      name: s.name,
      type: "bar",
      data:
        spec.colors && spec.series.length === 1
          ? s.values.map((v, j) => ({ value: v, itemStyle: { color: spec.colors![j] ?? color } }))
          : s.values,
      stack: spec.stacked ? "all" : undefined,
      itemStyle: { color },
      barMaxWidth: 26,
    };
  });
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { color: t.text },
    legend: spec.series.length > 1 && spec.kind !== "box" ? { top: 0, type: "scroll", textStyle: { color: t.dim }, pageTextStyle: { color: t.dim } } : undefined,
    tooltip: {
      trigger: spec.kind === "box" ? "item" : "axis",
      confine: true,
      axisPointer: { type: spec.kind === "line" ? "line" : "shadow" },
      formatter: spec.kind === "box" ? boxTooltip(spec) : axisTooltip(spec),
    },
    grid: {
      left: horizontal ? 8 : 12,
      right: 18,
      top: spec.series.length > 1 ? 32 : 18,
      bottom: (many && !horizontal && !spec.hideLabels ? 30 : 4) + (showXName ? 22 : 0),
      containLabel: true,
    },
    dataZoom: many && !horizontal && !spec.hideLabels ? [{ type: "inside" }, { type: "slider", height: 14, bottom: 4 }] : undefined,
    xAxis: horizontal ? value : category,
    yAxis: horizontal ? category : value,
    series,
  };
}

export function commonPrefix(labels: string[]): string {
  if (labels.length < 4) return "";
  let p = labels[0];
  for (const l of labels) {
    while (p && !l.startsWith(p)) p = p.slice(0, -1);
    if (!p) return "";
  }
  // Cut back to a separator so we don't split a token, and keep it meaningful.
  const cut = Math.max(p.lastIndexOf("_"), p.lastIndexOf("-"), p.lastIndexOf("."), p.lastIndexOf(" "));
  p = cut >= 0 ? p.slice(0, cut + 1) : "";
  return p.length >= 6 ? p : "";
}

function fmtVal(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toPrecision(4);
  if (v && typeof v === "object" && "value" in (v as any)) return fmtVal((v as any).value);
  return String(v ?? "–");
}

function axisTooltip(spec: ChartSpec) {
  return (params: any) => {
    const ps = Array.isArray(params) ? params : [params];
    if (!ps.length) return "";
    const i = ps[0].dataIndex;
    const head = `<b>${escapeHtml(spec.labels[i] ?? "")}</b>`;
    const lines = ps.map((p: any) => `${p.marker} ${escapeHtml(p.seriesName)}: <b>${fmtVal(p.value)}</b>`);
    const note = spec.notes?.[i] ? `<div style="opacity:.75;margin-top:3px">${escapeHtml(spec.notes[i])}</div>` : "";
    return [head, ...lines].join("<br/>") + note;
  };
}

function boxTooltip(spec: ChartSpec) {
  return (p: any) => {
    const v = p.value as number[];
    // echarts prepends the category index to boxplot values.
    const q = v.length === 6 ? v.slice(1) : v;
    const names = ["5%", "25%", "median", "75%", "95%"];
    return `<b>${escapeHtml(spec.labels[p.dataIndex] ?? "")}</b><br/>` +
      q.map((x, k) => `${names[k]}: <b>${Number(x).toFixed(2)}</b>`).join("<br/>");
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** CSV text for a chart's underlying data. */
export function specToCsv(spec: ChartSpec): string {
  const boxCols = ["p05", "q1", "median", "q3", "p95"];
  const header = [spec.xName ?? "category"];
  for (const s of spec.series) {
    if (spec.kind === "box") header.push(...boxCols.map((c) => `${s.name}_${c}`));
    else header.push(s.name);
  }
  const rows = spec.labels.map((l, i) => {
    const r: unknown[] = [l];
    for (const s of spec.series) {
      const v = s.values[i];
      if (Array.isArray(v)) r.push(...v);
      else r.push(v);
    }
    return r;
  });
  return toCsv(header, rows);
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}
