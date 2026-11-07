<script setup lang="ts">
// Quantification: protein x sample abundance matrix built from the pg view
// (or features summed per anchor protein), with intensity distributions,
// sample-sample correlation, PCA and a per-protein abundance profile.
import { computed, onMounted, ref, watch } from "vue";
import ChartCard from "../ChartCard.vue";
import ReportTable from "../ReportTable.vue";
import type { DatasetInfo } from "../../lib/api";
import { SERIES_COLORS, chartTheme, commonPrefix, escapeHtml, toCsv, type ChartSpec } from "../../lib/charts";
import { settings } from "../../lib/settings";
import { saveText } from "../../lib/export";
import { state } from "../../store";
import { useLargeGate } from "../../lib/useLargeGate";
import LargeGate from "./LargeGate.vue";
import {
  cachedSql,
  ident,
  listText,
  objects,
  proteinExpr,
  sampleMapSql,
  targetWhere,
  type Column,
  type DatasetTables,
  type TableRef,
} from "../../lib/report";
import {
  averageLinkageOrder,
  column,
  correlation,
  groupingColumns,
  medianNormalize,
  natural,
  pca,
  presence,
  quantile,
  type QuantMatrix,
} from "../../lib/quant";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string }>();

/** Matrices above this many columns skip the O(n²) correlation / PCA. */
const MAX_COLS = 400;

const hasInt = (r?: TableRef) => !!r?.cols.has("intensities");
const src: TableRef | undefined = hasInt(props.t.pg) ? props.t.pg : hasInt(props.t.feature) ? props.t.feature : undefined;
const srcKind = src === props.t.pg ? "pg" : "feature";

const busy = ref(true);
const { gate, check, release } = useLargeGate();
const error = ref("");
const raw = ref<QuantMatrix | null>(null);
const contaminant = ref<Uint8Array>(new Uint8Array());
const byRunOnly = ref(false);
/** Run channels left out because the run view maps no sample to them. */
const unmapped = ref(0);
/** The long-format result hit the row cap, so the matrix is incomplete. */
const truncated = ref(false);
const meta = ref<Map<string, Record<string, any>>>(new Map());

const normalise = ref(true);
const withCont = ref(false);
const minPresence = ref(0.5);
const groupBy = ref("");
const q = ref("");
const focus = ref<string | null>(null);
const protTable = ref<InstanceType<typeof ReportTable> | null>(null);

function matrixSql(S: TableRef): string {
  const prot = srcKind === "pg" ? "anchor_protein" : proteinExpr(S);
  const gene = S.cols.has("gg_names") ? "gg_names[1]" : "NULL";
  const run = S.cols.has("run_file_name") ? "run_file_name" : "'all'";
  // The contaminant flag is not always set; also match the usual name tags.
  const byName = `(contains(upper(${prot}), 'CONTAMINANT') OR contains(upper(${prot}), 'CON__'))`;
  const cont = S.cols.has("contaminant") ? `(coalesce(contaminant, false) OR ${byName})` : byName;
  const R = props.t.run?.cols.has("samples") ? props.t.run : undefined;
  const { ctes: maps, joins, col } = sampleMapSql(R);
  return `
WITH x AS (
  SELECT ${prot} AS p, ${gene} AS g, ${run} AS r, ${cont} AS c, unnest(intensities) AS i
  FROM ${ident(S.table)}
  WHERE ${targetWhere(S)} AND ${prot} IS NOT NULL AND len(intensities) > 0
)${maps}
SELECT x.p AS protein, any_value(x.g) AS gene, bool_or(x.c) AS cont, ${col} AS col,
       sum(x.i.intensity)::DOUBLE AS v, ${R ? "bool_and(m.sa IS NULL AND m1.sa IS NOT NULL)" : "false"} AS by_run,
       ${R ? "bool_and(m.sa IS NULL AND m1.sa IS NULL AND x.r IN (SELECT r FROM m))" : "false"} AS unmapped
FROM x ${joins}
WHERE x.i.intensity > 0
GROUP BY x.p, col`;
}

onMounted(() => {
  if (!src) return;
  check([{ ref: src, cols: ["is_decoy", "anchor_protein", "protein_accessions", "pg_accessions", "gg_names", "run_file_name", "contaminant", "intensities"] }], build);
});

async function build() {
  if (!src) return;
  busy.value = true;
  try {
    const r = await cachedSql(props.ds, `quant.${srcKind}`, matrixSql(src), 5_000_000);
    if (r.truncated) truncated.value = true;
    const [ip, ig, ic, icol, iv, ibr] = ["protein", "gene", "cont", "col", "v", "by_run"].map((c) => r.columns.indexOf(c));
    const iun = r.columns.indexOf("unmapped");
    const cols = new Map<string, number>();
    const prots = new Map<string, number>();
    const dropped = new Set<string>();
    const rowsIn = r.rows.filter((row) => {
      if (!row[iun]) return true;
      dropped.add(String(row[icol]));
      return false;
    });
    unmapped.value = dropped.size;
    for (const row of rowsIn) {
      const c = String(row[icol]);
      if (!cols.has(c)) cols.set(c, 0);
      const p = String(row[ip]);
      if (!prots.has(p)) prots.set(p, prots.size);
    }
    const samples = [...cols.keys()].sort(natural);
    samples.forEach((s, j) => cols.set(s, j));
    const n = samples.length;
    const values = Array.from({ length: prots.size }, () => new Float64Array(n).fill(NaN));
    const genes: (string | null)[] = new Array(prots.size).fill(null);
    const cont = new Uint8Array(prots.size);
    let runOnly = rowsIn.length > 0;
    for (const row of rowsIn) {
      const i = prots.get(String(row[ip]))!;
      const v = Number(row[iv]);
      if (v > 0) values[i][cols.get(String(row[icol]))!] = Math.log2(v);
      if (row[ig] != null) genes[i] = String(row[ig]);
      if (row[ic]) cont[i] = 1;
      if (!row[ibr]) runOnly = false;
    }
    raw.value = { samples, proteins: [...prots.keys()], genes, values };
    contaminant.value = cont;
    byRunOnly.value = runOnly;

    if (props.t.sample?.cols.has("sample_accession")) {
      const s = await cachedSql(props.ds, "quant.samples", `SELECT * FROM ${ident(props.t.sample.table)}`, 100000);
      meta.value = new Map(objects(s).map((x) => [String(x.sample_accession), x]));
    }
    groupBy.value = groupOptions.value[0] ?? "";
    const want = state.proteinFocus;
    focus.value = want && raw.value.proteins.includes(want) ? want : (shownProts.value[0]?.protein ?? null);
  } catch (e: any) {
    error.value = String(e?.message ?? e);
  } finally {
    busy.value = false;
  }
}

/** Matrix after the contaminant filter and normalisation. */
const matrix = computed<QuantMatrix | null>(() => {
  const m = raw.value;
  if (!m) return null;
  let out = m;
  if (!withCont.value) {
    const keep = m.proteins.map((_, i) => !contaminant.value[i]);
    out = {
      samples: m.samples,
      proteins: m.proteins.filter((_, i) => keep[i]),
      genes: m.genes.filter((_, i) => keep[i]),
      values: m.values.filter((_, i) => keep[i]),
    };
  }
  return normalise.value ? medianNormalize(out) : out;
});

const isSampleCols = computed(() => !!raw.value && raw.value.samples.some((s) => meta.value.has(s)));

/** Sample attributes that split the samples into 2..n-1 groups. */
const groupOptions = computed(() =>
  raw.value && isSampleCols.value ? groupingColumns(raw.value.samples, meta.value) : ([] as string[])
);

function groupOf(sample: string): string {
  if (!groupBy.value) return "";
  const v = meta.value.get(sample)?.[groupBy.value];
  return v == null || v === "" ? "not available" : String(v);
}

const groups = computed(() => {
  const m = matrix.value;
  if (!m || !groupBy.value) return [] as string[];
  return [...new Set(m.samples.map(groupOf))].sort(natural);
});
const groupColor = (g: string) => (g ? SERIES_COLORS[Math.max(0, groups.value.indexOf(g)) % SERIES_COLORS.length] : chartTheme().accent);

/** Samples ordered by group, then name. */
const order = computed(() => {
  const m = matrix.value;
  if (!m) return [] as number[];
  return m.samples.map((_, j) => j).sort((a, b) => natural(groupOf(m.samples[a]), groupOf(m.samples[b])) || natural(m.samples[a], m.samples[b]));
});

const prefix = computed(() => commonPrefix(raw.value?.samples ?? []));
const short = (s: string) => (prefix.value ? `…${s.slice(prefix.value.length)}` : s);

/** Proteins quantified in at least `minPresence` of the columns. */
const filteredRows = computed(() => {
  const m = matrix.value;
  if (!m) return [] as Float64Array[];
  const need = Math.max(2, Math.ceil(minPresence.value * m.samples.length));
  return m.values.filter((r) => presence(r) >= need);
});

const tooMany = computed(() => (matrix.value?.samples.length ?? 0) > MAX_COLS);

// ---- charts ----

const theme = computed(() => {
  void settings.theme;
  return chartTheme();
});

const distSpec = computed<ChartSpec | null>(() => {
  const m = matrix.value;
  if (!m) return null;
  const vals = order.value.map((j) => {
    const c = column(m, j).sort((a, b) => a - b);
    return c.length ? [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => quantile(c, p)) : null;
  });
  return {
    kind: "box",
    labels: order.value.map((j) => m.samples[j]),
    series: [{ name: "log2 abundance", values: vals }],
    xName: "sample",
    hideLabels: m.samples.length > 24,
  };
});

const countSpec = computed<ChartSpec | null>(() => {
  const m = matrix.value;
  if (!m) return null;
  return {
    kind: "bar",
    labels: order.value.map((j) => m.samples[j]),
    series: [{ name: "proteins", values: order.value.map((j) => column(m, j).length) }],
    colors: groupBy.value ? order.value.map((j) => groupColor(groupOf(m.samples[j]))) : undefined,
    notes: groupBy.value ? order.value.map((j) => `${groupBy.value}: ${groupOf(m.samples[j])}`) : undefined,
    xName: "sample",
    hideLabels: m.samples.length > 24,
  };
});

const corr = computed(() => {
  const m = matrix.value;
  if (!m || tooMany.value || m.samples.length < 2) return null;
  const r = correlation(filteredRows.value, m.samples.length);
  const ord = averageLinkageOrder(r.map((row) => row.map((v) => 1 - v)));
  return { r, ord };
});

const corrOption = computed(() => {
  const m = matrix.value;
  const c = corr.value;
  if (!m || !c) return null;
  const t = theme.value;
  const labels = c.ord.map((j) => m.samples[j]);
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
});

function corrCsv(): string {
  const m = matrix.value;
  const c = corr.value;
  if (!m || !c) return "";
  return toCsv(["sample", ...c.ord.map((j) => m.samples[j])], c.ord.map((a) => [m.samples[a], ...c.ord.map((b) => c.r[a][b])]));
}

const pcaRes = computed(() => {
  const m = matrix.value;
  if (!m || tooMany.value || m.samples.length < 3) return null;
  return pca(filteredRows.value, m.samples.length, 3);
});

const pcX = ref(0);
const pcY = ref(1);

const pcaOption = computed(() => {
  const m = matrix.value;
  const p = pcaRes.value;
  if (!m || !p) return null;
  const t = theme.value;
  const [cx, cy] = [pcX.value, pcY.value];
  const gs = groupBy.value ? groups.value : [""];
  const labelsOn = m.samples.length <= 40;
  const series = gs.map((g) => ({
    name: g || "samples",
    type: "scatter",
    symbolSize: 11,
    itemStyle: { color: groupColor(g), borderColor: t.bg, borderWidth: 1 },
    label: { show: labelsOn, position: "right", fontSize: 10, color: t.dim, formatter: (d: any) => short(d.data[2]) },
    labelLayout: { hideOverlap: true },
    data: m.samples.map((s, j) => (groupOf(s) === g || !groupBy.value ? [p.scores[j][cx], p.scores[j][cy], s] : null)).filter(Boolean),
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
    legend: groupBy.value ? { top: 0, type: "scroll", textStyle: { color: t.dim }, pageTextStyle: { color: t.dim } } : undefined,
    tooltip: {
      confine: true,
      formatter: (prm: any) => {
        const [x, y, s] = prm.data;
        const g = groupBy.value ? `<br/>${escapeHtml(groupBy.value)}: ${escapeHtml(groupOf(s))}` : "";
        return `<b>${escapeHtml(s)}</b>${g}<br/>PC${cx + 1} ${x.toFixed(2)} · PC${cy + 1} ${y.toFixed(2)}`;
      },
    },
    grid: { left: 34, right: 24, top: groupBy.value ? 34 : 14, bottom: 30, containLabel: true },
    xAxis: axis(pct(cx)),
    yAxis: { ...axis(pct(cy)), nameGap: 36, nameRotate: 90 },
    series,
  };
});

function pcaCsv(): string {
  const m = matrix.value;
  const p = pcaRes.value;
  if (!m || !p) return "";
  const head = ["sample", ...(groupBy.value ? [groupBy.value] : []), ...p.explained.map((_, c) => `PC${c + 1}`)];
  return toCsv(head, m.samples.map((s, j) => [s, ...(groupBy.value ? [groupOf(s)] : []), ...p.scores[j]]));
}

// ---- per-protein profile ----

interface ProtRow {
  protein: string;
  gene: string | null;
  n: number;
  mean: number | null;
  sd: number | null;
}

const protRows = computed<ProtRow[]>(() => {
  const m = matrix.value;
  if (!m) return [];
  return m.proteins.map((p, i) => {
    const xs = [...m.values[i]].filter(Number.isFinite);
    const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const sd = xs.length > 1 && mean != null ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : null;
    return { protein: p, gene: m.genes[i], n: xs.length, mean, sd };
  });
});

const shownProts = computed(() => {
  const s = q.value.trim().toLowerCase();
  const rows = s ? protRows.value.filter((r) => r.protein.toLowerCase().includes(s) || (r.gene ?? "").toLowerCase().includes(s)) : protRows.value;
  return [...rows].sort((a, b) => b.n - a.n || (b.mean ?? 0) - (a.mean ?? 0)).slice(0, 500);
});

watch(shownProts, (rows) => {
  if (!focus.value && rows.length) focus.value = rows[0].protein;
});

const protCols: Column[] = [
  { key: "protein", label: "Anchor protein" },
  { key: "gene", label: "Gene" },
  { key: "n", label: "Quantified in", num: true },
  { key: "mean", label: "Mean log2", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(2)) },
  { key: "sd", label: "SD log2", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(2)), title: "Standard deviation of log2 abundance across samples" },
];

const focusRow = computed(() => protRows.value.find((r) => r.protein === focus.value) ?? null);

const profileOption = computed(() => {
  const m = matrix.value;
  if (!m || !focus.value) return null;
  const i = m.proteins.indexOf(focus.value);
  if (i < 0) return null;
  const t = theme.value;
  const row = m.values[i];
  const labels = order.value.map((j) => m.samples[j]);
  const data = order.value.map((j) => ({
    value: Number.isFinite(row[j]) ? +row[j].toFixed(4) : null,
    itemStyle: { color: groupColor(groupOf(m.samples[j])) },
  }));
  // Mean per group, drawn as a line segment over that group's bars.
  const marks: any[] = [];
  if (groupBy.value) {
    let start = 0;
    for (let k = 1; k <= labels.length; k++) {
      if (k < labels.length && groupOf(labels[k]) === groupOf(labels[start])) continue;
      const xs = order.value.slice(start, k).map((j) => row[j]).filter(Number.isFinite);
      if (xs.length) {
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
        marks.push([
          { coord: [labels[start], mean], name: groupOf(labels[start]), lineStyle: { color: groupColor(groupOf(labels[start])), width: 2, type: "solid" } },
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
    legend: groupBy.value
      ? { top: 0, type: "scroll", data: groups.value.map((g) => ({ name: g, itemStyle: { color: groupColor(g) } })), textStyle: { color: t.dim }, pageTextStyle: { color: t.dim } }
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
        const g = groupBy.value ? `<br/>${escapeHtml(groupBy.value)}: ${escapeHtml(groupOf(s))}` : "";
        return `<b>${escapeHtml(s)}</b>${g}<br/>log2 abundance <b>${v == null ? "not quantified" : Number(v).toFixed(2)}</b>`;
      },
    },
    grid: { left: 26, right: 18, top: groupBy.value ? 32 : 14, bottom: labels.length > 60 ? 8 : 4, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { show: labels.length <= 60, color: t.dim, rotate: labels.length > 10 ? 45 : 0, fontSize: 10, formatter: short, hideOverlap: true },
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
      ...groups.value.map((g) => ({ name: g, type: "line", data: [], itemStyle: { color: groupColor(g) } })),
    ],
  };
});

function profileCsv(): string {
  const m = matrix.value;
  if (!m || !focus.value) return "";
  const i = m.proteins.indexOf(focus.value);
  const head = ["sample", ...(groupBy.value ? [groupBy.value] : []), "log2_abundance"];
  return toCsv(head, order.value.map((j) => [m.samples[j], ...(groupBy.value ? [groupOf(m.samples[j])] : []), Number.isFinite(m.values[i][j]) ? m.values[i][j] : null]));
}

const saved = ref("");
async function exportMatrixFile() {
  try {
    const p = await saveText(`${props.fileBase}_protein_matrix_log2`, exportMatrix());
    if (p) {
      saved.value = "Saved";
      window.setTimeout(() => (saved.value = ""), 2500);
    }
  } catch (e) {
    saved.value = String(e);
  }
}

function exportMatrix(): string {
  const m = matrix.value;
  if (!m) return "";
  return toCsv(
    ["anchor_protein", "gene", ...m.samples],
    m.proteins.map((p, i) => [p, m.genes[i], ...[...m.values[i]].map((v) => (Number.isFinite(v) ? +v.toFixed(5) : null))])
  );
}

const colUnit = computed(() => (isSampleCols.value ? "samples" : "runs"));
const sourceText = computed(() => {
  const what = srcKind === "pg" ? "protein-group intensities (pg view)" : "feature intensities summed per anchor protein";
  const cols = isSampleCols.value
    ? byRunOnly.value
      ? "runs mapped to samples via the run view"
      : "run channels mapped to samples via the run view (fractions summed)"
    : "one column per run (and channel)";
  const skip = unmapped.value ? ` ${unmapped.value} run channels without a sample in the run view were left out.` : "";
  const cut = truncated.value ? " ⚠ The matrix is too large and was truncated at 5 million values; some proteins/samples are incomplete." : "";
  return `${what}; ${cols}; log2${normalise.value ? ", median-normalised" : ""}.${skip}${cut}`;
});
</script>

<template>
  <div>
    <div v-if="!src" class="muted pad">This dataset has no quantitative intensities (pg or feature view with <code>intensities</code>).</div>
    <div v-else-if="error" class="error pad">⚠ {{ error }}</div>
    <LargeGate v-else-if="gate.blocked" :bytes="gate.bytes" :size="gate.size" what="Building the protein × sample matrix" @go="release" />
    <div v-else-if="busy" class="muted pad">Building the protein × sample matrix… <span class="spinner"></span></div>
    <template v-else-if="matrix">
      <div class="bar">
        <span class="muted">
          <b>{{ matrix.proteins.length.toLocaleString() }}</b> proteins × <b>{{ matrix.samples.length.toLocaleString() }}</b> {{ colUnit }} ·
          {{ sourceText }}
        </span>
        <span class="ctl">
          <label><input v-model="normalise" type="checkbox" /> Median-normalise</label>
          <label><input v-model="withCont" type="checkbox" /> Contaminants</label>
          <label title="Proteins used for correlation and PCA">
            Quantified in ≥
            <select v-model.number="minPresence">
              <option :value="0">any 2</option>
              <option :value="0.5">50%</option>
              <option :value="0.7">70%</option>
              <option :value="1">100%</option>
            </select>
            of {{ colUnit }}
          </label>
          <label v-if="groupOptions.length">
            Colour by
            <select v-model="groupBy">
              <option value="">none</option>
              <option v-for="g in groupOptions" :key="g" :value="g">{{ g.replace(/_/g, " ") }}</option>
            </select>
          </label>
          <span v-if="saved" class="muted">{{ saved }}</span>
          <button class="xs" title="Save the log2 protein × sample matrix as CSV" @click="exportMatrixFile">Matrix CSV</button>
        </span>
      </div>

      <div class="grid">
        <ChartCard title="Abundance distribution" :subtitle="`log2 abundance per ${colUnit.slice(0, -1)} (5–95% whiskers).`" :spec="distSpec" :file-base="fileBase" :height="240" />
        <ChartCard title="Proteins quantified" :subtitle="`Proteins with an intensity in each ${colUnit.slice(0, -1)}.`" :spec="countSpec" :file-base="fileBase" :height="240" />
      </div>
      <div class="grid">
        <ChartCard
          v-if="!tooMany"
          title="Sample correlation"
          :subtitle="`Pearson r of log2 abundance, ${filteredRows.length.toLocaleString()} proteins; clustered (average linkage).`"
          :option="corrOption"
          :csv="corrCsv"
          :empty-text="matrix.samples.length < 2 ? `Needs at least 2 ${colUnit}.` : ''"
          :file-base="fileBase"
          :height="Math.min(620, Math.max(320, matrix.samples.length * 14 + 120))"
        />
        <ChartCard
          v-if="!tooMany"
          title="PCA"
          :subtitle="pcaRes ? `${pcaRes.used.toLocaleString()} proteins, mean-centred; missing values set to the protein mean.` : 'Needs at least 3 samples.'"
          :option="pcaOption"
          :csv="pcaCsv"
          :empty-text="matrix.samples.length < 3 ? `Needs at least 3 ${colUnit}.` : ''"
          :file-base="fileBase"
          :height="Math.min(620, Math.max(320, matrix.samples.length * 14 + 120))"
        >
          <template #actions>
            <select v-if="pcaRes" v-model.number="pcX" class="pc"><option v-for="c in pcaRes.explained.length" :key="c" :value="c - 1">PC{{ c }}</option></select>
            <select v-if="pcaRes" v-model.number="pcY" class="pc"><option v-for="c in pcaRes.explained.length" :key="c" :value="c - 1">PC{{ c }}</option></select>
          </template>
        </ChartCard>
        <div v-else class="muted note">Correlation and PCA are skipped above {{ MAX_COLS }} {{ colUnit }} ({{ matrix.samples.length }} here).</div>
      </div>

      <div class="profile">
        <div class="left">
          <div class="sec-head">
            <h3>Proteins <span class="muted">({{ shownProts.length.toLocaleString() }}{{ shownProts.length === 500 ? "+" : "" }})</span></h3>
            <input v-model="q" class="filter" placeholder="Filter accession or gene…" />
          </div>
          <ReportTable
            ref="protTable"
            :columns="protCols"
            :rows="shownProts"
            row-key="protein"
            :selected="focus"
            clickable
            max-height="420px"
            :file-name="`${fileBase}_quant_proteins`"
            @row="(r) => (focus = r.protein)"
          >
            <template #cell-protein="{ value }"><span class="mono acc">{{ value }}</span></template>
            <template #cell-gene="{ value }"><b>{{ listText(value) }}</b></template>
          </ReportTable>
        </div>
        <ChartCard
          class="right"
          :title="focus ? `Abundance profile · ${focusRow?.gene ?? focus}` : 'Abundance profile'"
          :subtitle="focusRow ? `${focus} · quantified in ${focusRow.n} of ${matrix.samples.length} ${colUnit}${groupBy ? ' · lines = group means' : ''}` : 'Pick a protein.'"
          :option="profileOption"
          :csv="profileCsv"
          :empty-text="focus ? '' : 'Pick a protein.'"
          :file-base="`${fileBase}_${focusRow?.gene ?? focus ?? ''}`"
          :height="420"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 12px;
  font-size: 12px;
}
.ctl {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.ctl label {
  display: flex;
  gap: 4px;
  align-items: center;
}
.ctl select,
select.pc {
  font-size: 11px;
  padding: 1px 4px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}
@media (max-width: 1100px) {
  .grid,
  .profile {
    grid-template-columns: minmax(0, 1fr);
  }
}
.note {
  padding: 18px;
  font-size: 12px;
}
.profile {
  display: grid;
  grid-template-columns: minmax(380px, 2fr) 3fr;
  gap: 14px;
  margin-top: 4px;
  align-items: start;
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 10px;
}
h3 {
  margin: 0;
  font-size: 14px;
}
.filter {
  padding: 4px 8px;
  font-size: 12px;
  width: 200px;
}
.acc {
  font-size: 11px;
}
button.xs {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 6px;
}
.pad {
  padding: 18px;
}
</style>
