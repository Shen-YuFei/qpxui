<script setup lang="ts">
// Quantification: protein x sample abundance matrix built from the pg view
// (or features summed per anchor protein), with intensity distributions,
// sample-sample correlation, PCA and a per-protein abundance profile.
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import ChartCard from "../ChartCard.vue";
import QuantProteinProfile from "./QuantProteinProfile.vue";
import type { DatasetInfo } from "../../lib/api";
import { chartTheme, commonPrefix, seriesColor, type ChartSpec } from "../../lib/charts";
import {
  correlationChart,
  correlationCsv,
  distributionSpec,
  matrixCsv,
  pcaChart,
  pcaCsv as pcaScoresCsv,
  profileChart,
  profileCsv as proteinProfileCsv,
  proteinCountSpec,
  type SampleStyle,
} from "../../lib/quantCharts";
import { settings } from "../../lib/settings";
import { saveText } from "../../lib/export";
import { state } from "../../store";
import { useLargeGate } from "../../lib/useLargeGate";
import LargeGate from "./LargeGate.vue";
import type { DatasetTables } from "../../lib/report";
import { QUANT_COLUMNS, quantMatrix, quantSource, sampleMeta } from "../../lib/queries/quant";
import {
  averageLinkageOrder,
  correlation,
  findProteins,
  groupedOrder,
  groupingColumns,
  medianNormalize,
  natural,
  pca,
  presence,
  proteinSummaries,
  sampleGroup,
  withoutFlagged,
  type ProteinSummary,
  type QuantMatrix,
} from "../../lib/quant";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string }>();

/** Matrices above this many columns skip the O(n²) correlation / PCA. */
const MAX_COLS = 400;

const source = quantSource(props.t);
const src = source?.ref;
const srcKind = source?.kind ?? "feature";

const busy = ref(true);
const { gate, check, release, dispose } = useLargeGate();
onUnmounted(dispose);
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

onMounted(() => {
  if (!src) return;
  check([{ ref: src, cols: QUANT_COLUMNS }], build);
});

async function build() {
  if (!source) return;
  busy.value = true;
  try {
    const q = await quantMatrix(props.ds, props.t, source);
    if (q.truncated) truncated.value = true;
    unmapped.value = q.unmapped;
    raw.value = q.matrix;
    contaminant.value = q.contaminant;
    byRunOnly.value = q.byRunOnly;

    if (props.t.sample?.cols.has("sample_accession")) meta.value = await sampleMeta(props.ds, props.t.sample);
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
  const out = withCont.value ? m : withoutFlagged(m, contaminant.value);
  return normalise.value ? medianNormalize(out) : out;
});

const isSampleCols = computed(() => !!raw.value && raw.value.samples.some((s) => meta.value.has(s)));

/** Sample attributes that split the samples into 2..n-1 groups. */
const groupOptions = computed(() =>
  raw.value && isSampleCols.value ? groupingColumns(raw.value.samples, meta.value) : ([] as string[])
);

const groupOf = (sample: string) => sampleGroup(meta.value, groupBy.value, sample);

const groups = computed(() => {
  const m = matrix.value;
  if (!m || !groupBy.value) return [] as string[];
  return [...new Set(m.samples.map(groupOf))].sort(natural);
});
const groupColor = (g: string) => (g ? seriesColor(groups.value, g) : chartTheme().accent);

/** Samples ordered by group, then name. */
const order = computed(() => {
  const m = matrix.value;
  if (!m) return [] as number[];
  return groupedOrder(m.samples, groupOf);
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
const style = computed<SampleStyle>(() => ({
  theme: theme.value,
  short,
  groupBy: groupBy.value,
  groups: groups.value,
  groupOf,
  groupColor,
}));

const distSpec = computed<ChartSpec | null>(() => (matrix.value ? distributionSpec(matrix.value, order.value) : null));

const countSpec = computed<ChartSpec | null>(() =>
  matrix.value ? proteinCountSpec(matrix.value, order.value, groupBy.value, groupOf, groupColor) : null
);

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
  return m && c ? correlationChart(m.samples, c, theme.value, short) : null;
});

function corrCsv(): string {
  const m = matrix.value;
  const c = corr.value;
  if (!m || !c) return "";
  return correlationCsv(m.samples, c);
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
  return m && p ? pcaChart(m.samples, p, pcX.value, pcY.value, style.value) : null;
});

function pcaCsv(): string {
  const m = matrix.value;
  const p = pcaRes.value;
  if (!m || !p) return "";
  return pcaScoresCsv(m.samples, p, groupBy.value, groupOf);
}

// ---- per-protein profile ----

const protRows = computed<ProteinSummary[]>(() => (matrix.value ? proteinSummaries(matrix.value) : []));

const shownProts = computed(() => findProteins(protRows.value, q.value));

watch(shownProts, (rows) => {
  if (!focus.value && rows.length) focus.value = rows[0].protein;
});

const focusRow = computed(() => protRows.value.find((r) => r.protein === focus.value) ?? null);

const profileOption = computed(() => {
  const m = matrix.value;
  if (!m || !focus.value) return null;
  const i = m.proteins.indexOf(focus.value);
  return i < 0 ? null : profileChart(m.samples, order.value, m.values[i], style.value);
});

function profileCsv(): string {
  const m = matrix.value;
  // The contaminant filter can hide the focused protein.
  const i = m && focus.value ? m.proteins.indexOf(focus.value) : -1;
  return m && i >= 0 ? proteinProfileCsv(m.samples, order.value, m.values[i], groupBy.value, groupOf) : "";
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
  return m ? matrixCsv(m) : "";
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
    <div v-else-if="gate.error" class="error pad">⚠ {{ gate.error }}</div>
    <div v-else-if="gate.checking" class="muted pad"><span class="spinner"></span></div>
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

      <QuantProteinProfile
        v-model:focus="focus"
        v-model:q="q"
        :rows="shownProts"
        :focus-row="focusRow"
        :option="profileOption"
        :csv="profileCsv"
        :n-cols="matrix.samples.length"
        :col-unit="colUnit"
        :group-by="groupBy"
        :file-base="fileBase"
      />
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
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.note {
  padding: 18px;
  font-size: 12px;
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
