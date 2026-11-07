<script setup lang="ts">
// Per-peptidoform profile: every feature (or PSM) of one peptidoform, with its
// intensity in each sample (runs and channels mapped to samples through the
// run view), the intensity distribution per sample group, and the retention
// time in each run.
import { computed, ref, watch } from "vue";
import ChartCard from "../ChartCard.vue";
import type { DatasetInfo } from "../../lib/api";
import { chartTheme, seriesColor, toCsv } from "../../lib/charts";
import { distributionChart, retentionChart, sampleChart, type Feature, type ProfileStyle } from "../../lib/peptidoformCharts";
import { runSql } from "../../lib/duck";
import { groupingColumns, natural, quantile, sampleGroup } from "../../lib/quant";
import {
  cachedSql,
  ident,
  lit,
  objects,
  sampleMapSql,
  targetWhere,
  type DatasetTables,
  type TableRef,
} from "../../lib/report";
import { settings } from "../../lib/settings";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; peptidoform: string; fileBase: string }>();

const MAX_FEATURES = 20000;

const hasInt = (r?: TableRef) => !!r?.cols.has("intensities");
/** Quantified evidence first: features, then PSMs that carry intensities. */
const src = computed<TableRef | undefined>(() =>
  hasInt(props.t.feature) ? props.t.feature : hasInt(props.t.psm) ? props.t.psm : props.t.feature ?? props.t.psm
);
const srcLabel = computed(() => (src.value === props.t.feature ? "features" : "PSMs"));

interface Channel {
  fid: number;
  sample: string;
  label: string | null;
  intensity: number;
}

const busy = ref(false);
const error = ref("");
const medError = ref("");
const features = ref<Feature[]>([]);
const channels = ref<Channel[]>([]);
const truncated = ref(false);
const meta = ref<Map<string, Record<string, any>>>(new Map());
const allRuns = ref<string[]>([]);
const groupBy = ref("");
const normalise = ref(false);
const medians = ref<Map<string, number> | null>(null);
const medBusy = ref(false);

const pfCol = (S: TableRef) => (S.cols.has("peptidoform") ? "peptidoform" : S.seq);

function profileSql(S: TableRef): string {
  const has = (c: string) => S.cols.has(c);
  const sec = (c: string) => (has(c) ? `${c} / 60.0` : "NULL");
  const quant = hasInt(S);
  const map = sampleMapSql(props.t.run);
  const f = `f AS MATERIALIZED (
  SELECT row_number() OVER ()::BIGINT AS fid, ${has("run_file_name") ? "run_file_name" : "'all'"} AS r,
         ${has("charge") ? "charge" : "NULL"} AS z, ${sec("rt")} AS rt, ${sec("rt_start")} AS rt_lo, ${sec("rt_stop")} AS rt_hi,
         ${has("posterior_error_probability") ? "posterior_error_probability" : "NULL"} AS pep${quant ? ", intensities" : ""}
  FROM ${ident(S.table)} WHERE ${targetWhere(S)} AND ${pfCol(S)} = ${lit(props.peptidoform)}
  LIMIT ${MAX_FEATURES + 1})`;
  if (!quant) {
    return `WITH ${f} SELECT fid, r AS run, z AS charge, rt, rt_lo, rt_hi, pep, NULL AS label, NULL AS sample, NULL AS intensity FROM f ORDER BY fid`;
  }
  return `WITH ${f},
x AS (SELECT fid, r, unnest(intensities) AS i FROM f WHERE len(intensities) > 0)${map.ctes},
s AS (SELECT x.fid, x.i.label AS label, ${map.col} AS sample, x.i.intensity::DOUBLE AS intensity FROM x ${map.joins} WHERE x.i.intensity > 0)
SELECT f.fid, f.r AS run, f.z AS charge, f.rt, f.rt_lo, f.rt_hi, f.pep, s.label, s.sample, s.intensity
FROM f LEFT JOIN s USING (fid) ORDER BY f.fid`;
}

const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

let seq = 0;
async function load() {
  const S = src.value;
  if (!S) return;
  const id = ++seq;
  busy.value = true;
  error.value = "";
  features.value = [];
  channels.value = [];
  try {
    const [r] = await Promise.all([runSql(profileSql(S), MAX_FEATURES * 40), loadContext().catch(() => {})]);
    if (id !== seq) return;
    const fs = new Map<number, Feature>();
    const ch: Channel[] = [];
    for (const row of objects(r)) {
      const fid = Number(row.fid);
      if (!fs.has(fid)) {
        fs.set(fid, {
          fid,
          run: String(row.run),
          charge: num(row.charge),
          rt: num(row.rt),
          rtLo: num(row.rt_lo),
          rtHi: num(row.rt_hi),
          pep: num(row.pep),
        });
      }
      const v = num(row.intensity);
      if (row.sample != null && v != null && v > 0) ch.push({ fid, sample: String(row.sample), label: row.label == null ? null : String(row.label), intensity: v });
    }
    truncated.value = fs.size > MAX_FEATURES;
    features.value = [...fs.values()].slice(0, MAX_FEATURES);
    channels.value = ch;
    if (!groupOptions.value.includes(groupBy.value)) groupBy.value = groupOptions.value[0] ?? "";
  } catch (e: any) {
    if (id === seq) error.value = String(e?.message ?? e);
  } finally {
    if (id === seq) busy.value = false;
  }
}

/** Sample metadata and the full run list, shared with the Quantification tab cache. */
async function loadContext() {
  if (!meta.value.size && props.t.sample?.cols.has("sample_accession")) {
    const s = await cachedSql(props.ds, "quant.samples", `SELECT * FROM ${ident(props.t.sample.table)}`, 100000);
    meta.value = new Map(objects(s).map((x) => [String(x.sample_accession), x]));
  }
  if (!allRuns.value.length && props.t.run?.cols.has("run_file_name")) {
    const r = await cachedSql(props.ds, "pep.runs", `SELECT DISTINCT run_file_name FROM ${ident(props.t.run.table)}`, 100000);
    allRuns.value = r.rows.map((x) => String(x[0])).sort(natural);
  }
}

/** Median log2 intensity of every sample over all target evidence, for normalisation. */
async function loadMedians() {
  const S = src.value;
  if (!S || !hasInt(S) || medians.value || medBusy.value) return;
  medBusy.value = true;
  try {
    const map = sampleMapSql(props.t.run);
    const r = await cachedSql(
      props.ds,
      `pep.medians.${S === props.t.feature ? "feature" : "psm"}`,
      `WITH x AS (SELECT run_file_name AS r, unnest(intensities) AS i FROM ${ident(S.table)} WHERE ${targetWhere(S)} AND len(intensities) > 0)${map.ctes}
       SELECT ${map.col} AS sample, median(log2(x.i.intensity)) AS med FROM x ${map.joins} WHERE x.i.intensity > 0 GROUP BY 1`,
      100000
    );
    medians.value = new Map(r.rows.map((x) => [String(x[0]), Number(x[1])]));
  } catch (e: any) {
    medError.value = String(e?.message ?? e);
    normalise.value = false;
  } finally {
    medBusy.value = false;
  }
}

watch(normalise, (on) => on && loadMedians());
watch(() => props.peptidoform, load, { immediate: true });

// ---- derived values ----

const isSamples = computed(() => channels.value.some((c) => meta.value.has(c.sample)));
const groupOptions = computed(() => (isSamples.value ? groupingColumns([...meta.value.keys()], meta.value) : []));
const groupOf = (sample: string) => sampleGroup(meta.value, groupBy.value, sample);

/** Every sample the peptidoform could be in (all mapped samples), else those seen. */
const sampleAxis = computed(() => {
  const seen = new Set(channels.value.map((c) => c.sample));
  const all = isSamples.value ? new Set([...meta.value.keys(), ...seen]) : seen;
  return [...all].sort((a, b) => natural(groupOf(a), groupOf(b)) || natural(a, b));
});
const groups = computed(() => (groupBy.value ? [...new Set(sampleAxis.value.map(groupOf))].sort(natural) : []));
const groupColor = (g: string) => (g ? seriesColor(groups.value, g) : chartTheme().accent);

/** log2 intensity per sample, summed over the peptidoform's features (charges, fractions). */
const perSample = computed(() => {
  const sum = new Map<string, { v: number; n: number }>();
  for (const c of channels.value) {
    const e = sum.get(c.sample) ?? { v: 0, n: 0 };
    e.v += c.intensity;
    e.n += 1;
    sum.set(c.sample, e);
  }
  const med = normalise.value ? medians.value : null;
  const out = new Map<string, { log2: number; n: number }>();
  for (const [s, e] of sum) {
    const shift = med?.get(s);
    out.set(s, { log2: Math.log2(e.v) - (med ? shift ?? NaN : 0), n: e.n });
  }
  return out;
});

const runs = computed(() => {
  const seen = new Set(features.value.map((f) => f.run));
  return [...new Set([...allRuns.value, ...seen])].sort(natural);
});
const charges = computed(() => [...new Set(features.value.map((f) => f.charge))].sort((a, b) => (a ?? 0) - (b ?? 0)));

const stats = computed(() => {
  const rts = features.value.map((f) => f.rt).filter((x): x is number => x != null).sort((a, b) => a - b);
  const ints = [...perSample.value.values()].map((x) => 2 ** x.log2).filter(Number.isFinite);
  const mean = ints.reduce((a, b) => a + b, 0) / (ints.length || 1);
  const sd = ints.length > 1 ? Math.sqrt(ints.reduce((a, b) => a + (b - mean) ** 2, 0) / (ints.length - 1)) : NaN;
  return {
    runs: new Set(features.value.map((f) => f.run)).size,
    samples: perSample.value.size,
    rtMedian: rts.length ? quantile(rts, 0.5) : null,
    rtIqr: rts.length > 1 ? quantile(rts, 0.75) - quantile(rts, 0.25) : null,
    rtRange: rts.length ? rts[rts.length - 1] - rts[0] : null,
    cv: Number.isFinite(sd) && mean > 0 ? (100 * sd) / mean : null,
  };
});

const theme = computed(() => {
  void settings.theme;
  return chartTheme();
});
const yLabel = computed(() => (normalise.value ? "log2 intensity − sample median" : "log2 intensity"));

const style = computed<ProfileStyle>(() => ({
  theme: theme.value,
  groupBy: groupBy.value,
  groups: groups.value,
  groupOf,
  groupColor,
  yLabel: yLabel.value,
}));

const sampleOption = computed(() => (channels.value.length ? sampleChart(sampleAxis.value, perSample.value, srcLabel.value, style.value) : null));

function sampleCsv(): string {
  const head = ["sample", ...(groupBy.value ? [groupBy.value] : []), normalise.value ? "log2_intensity_minus_sample_median" : "log2_intensity", "n_summed"];
  return toCsv(head, sampleAxis.value.map((s) => {
    const v = perSample.value.get(s);
    return [s, ...(groupBy.value ? [groupOf(s)] : []), v && Number.isFinite(v.log2) ? v.log2 : null, v?.n ?? 0];
  }));
}

const distOption = computed(() =>
  perSample.value.size ? distributionChart(sampleAxis.value, perSample.value, isSamples.value ? "samples" : "runs", style.value) : null
);

function distCsv(): string {
  return toCsv(["sample", ...(groupBy.value ? [groupBy.value] : []), normalise.value ? "log2_intensity_minus_sample_median" : "log2_intensity"],
    [...perSample.value].map(([s, v]) => [s, ...(groupBy.value ? [groupOf(s)] : []), Number.isFinite(v.log2) ? v.log2 : null]));
}

const rtOption = computed(() =>
  features.value.some((f) => f.rt != null) ? retentionChart(features.value, runs.value, charges.value, stats.value.rtMedian, theme.value) : null
);

function rtCsv(): string {
  return toCsv(["run_file_name", "charge", "rt_min", "rt_start_min", "rt_stop_min", "posterior_error_probability"],
    features.value.map((f) => [f.run, f.charge, f.rt, f.rtLo, f.rtHi, f.pep]));
}

const fmt = (x: number | null, d = 2) => (x == null ? "–" : x.toFixed(d));
const base = computed(() => `${props.fileBase}_${props.peptidoform.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 60)}`);
</script>

<template>
  <div class="profile">
    <div v-if="!src" class="muted">No feature or PSM view in this dataset.</div>
    <div v-else-if="error" class="error">⚠ {{ error }}</div>
    <div v-else-if="busy" class="muted">Loading every {{ srcLabel.slice(0, -1) }} of this peptidoform… <span class="spinner"></span></div>
    <template v-else>
      <div class="kpis">
        <div><b>{{ features.length.toLocaleString() }}{{ truncated ? "+" : "" }}</b><span>{{ srcLabel }}</span></div>
        <div><b>{{ stats.runs }}<template v-if="allRuns.length"> / {{ allRuns.length }}</template></b><span>runs</span></div>
        <div v-if="channels.length"><b>{{ stats.samples }}<template v-if="isSamples"> / {{ meta.size }}</template></b><span>{{ isSamples ? "samples" : "run channels" }}</span></div>
        <div><b>{{ charges.map((z) => z ?? "?").join(", ") }}</b><span>charges</span></div>
        <div><b>{{ fmt(stats.rtMedian) }}</b><span>median RT (min)</span></div>
        <div><b>{{ fmt(stats.rtIqr) }}</b><span>RT IQR (min)</span></div>
        <div v-if="stats.cv != null"><b>{{ stats.cv.toFixed(0) }}%</b><span>intensity CV</span></div>
      </div>
      <div class="ctl">
        <label v-if="groupOptions.length">
          Group by
          <select v-model="groupBy">
            <option value="">none</option>
            <option v-for="g in groupOptions" :key="g" :value="g">{{ g.replace(/_/g, " ") }}</option>
          </select>
        </label>
        <label v-if="channels.length" title="Subtract each sample's median log2 intensity over all evidence (reads the whole intensities column once)">
          <input v-model="normalise" type="checkbox" :disabled="medBusy" /> Normalise to sample median
          <span v-if="medBusy" class="spinner"></span>
          <span v-if="medError" class="muted error-inline" :title="medError">⚠ medians failed</span>
        </label>
        <span v-if="truncated" class="muted">Only the first {{ MAX_FEATURES.toLocaleString() }} {{ srcLabel }} are shown.</span>
      </div>
      <ChartCard
        v-if="channels.length"
        :title="isSamples ? 'Intensity across samples' : 'Intensity across runs'"
        :subtitle="`${yLabel}, summed over charges and fractions; empty = not quantified${groupBy ? '; coloured by ' + groupBy.replace(/_/g, ' ') : ''}.`"
        :option="sampleOption"
        :csv="sampleCsv"
        :file-base="`${base}_samples`"
        :height="260"
      />
      <div v-else class="muted note">This {{ srcLabel === "features" ? "feature" : "PSM" }} view has no intensities, so only retention times are shown.</div>
      <div class="pair">
        <ChartCard
          v-if="channels.length"
          title="Intensity distribution"
          :subtitle="`${groupBy ? 'Per ' + groupBy.replace(/_/g, ' ') : isSamples ? 'All samples' : 'All runs'}; box = 5/25/50/75/95%, dots = ${isSamples ? 'samples' : 'runs'}.`"
          :option="distOption"
          :csv="distCsv"
          :file-base="`${base}_distribution`"
          :height="260"
        />
        <ChartCard
          title="Retention time across runs"
          :subtitle="`Apex RT per ${srcLabel.slice(0, -1)}, coloured by charge${features.some((f) => f.rtLo != null) ? '; bars = elution window' : ''}.`"
          :option="rtOption"
          :csv="rtCsv"
          :empty-text="features.some((f) => f.rt != null) ? '' : 'No retention times recorded.'"
          :file-base="`${base}_rt`"
          :height="260"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.profile {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.kpis {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
}
.kpis > div {
  display: flex;
  flex-direction: column;
}
.kpis b {
  font-size: 15px;
}
.kpis span {
  font-size: 11px;
  color: var(--text-dim);
}
.ctl {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  font-size: 12px;
}
.ctl label {
  display: flex;
  gap: 4px;
  align-items: center;
}
.ctl select {
  font-size: 11px;
  padding: 1px 4px;
}
.pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 10px;
}
.note {
  font-size: 12px;
}
</style>
