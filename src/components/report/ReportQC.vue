<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import ChartCard from "../ChartCard.vue";
import ReportTable from "../ReportTable.vue";
import type { DatasetInfo } from "../../lib/api";
import type { ChartSpec } from "../../lib/charts";
import { evidence, type Column, type DatasetTables } from "../../lib/report";
import { QC_COUNT_COLUMNS, QC_EVIDENCE_COLUMNS, runMetrics, sampleIntensities } from "../../lib/queries/qc";
import { fmtNum } from "../../lib/format";
import { useSlots } from "../../lib/useSlots";
import { useLargeGate } from "../../lib/useLargeGate";
import LargeGate from "./LargeGate.vue";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string }>();

const ev = evidence(props.t);
const evName = props.t.feature ? "features" : "PSMs";
const { gate, check, release, dispose } = useLargeGate();
onUnmounted(dispose);

const runRows = ref<Record<string, any>[]>([]);
const runCols = ref<Column[]>([]);
const runBusy = ref(true);
const runError = ref("");
const table = ref<InstanceType<typeof ReportTable> | null>(null);

const KEYS = ["runMetrics", "runInt", "runPpm", "sampleBox"] as const;
const { slots, progress, run } = useSlots(KEYS);

/** Per-run metrics from the evidence view joined with PSM / PG / run views. */
async function loadRuns() {
  if (!ev || !ev.cols.has("run_file_name")) {
    runBusy.value = false;
    return;
  }
  const { rows, columns } = await runMetrics(props.ds, props.t, ev);
  runRows.value = rows;

  const all: Column[] = [
    { key: "run_file_name", label: "Run" },
    { key: "n_samples", label: "Samples", num: true },
    { key: "fraction", label: "Fraction" },
    { key: "n_ev", label: evName === "features" ? "Features" : "PSMs", num: true },
    { key: "n_psm", label: "PSMs", num: true },
    { key: "n_pep", label: "Peptides", num: true },
    { key: "n_prot", label: "Proteins", num: true },
    { key: "n_pg", label: "Protein groups", num: true },
    { key: "med_int", label: "Median log10 int.", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(2)) },
    { key: "med_ppm", label: "Median ppm", num: true, fmt: (v) => (v == null ? "" : fmtNum(Number(v))) },
    { key: "med_rt", label: "Median RT (min)", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(1)) },
    { key: "avg_charge", label: "Mean charge", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(2)) },
    { key: "pct_mc", label: "% missed cl.", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(1)) },
    { key: "instrument", label: "Instrument" },
  ];
  runCols.value = all.filter((c) => columns.includes(c.key));
}

function runMetricsSpec(): ChartSpec | null {
  const rows = runRows.value;
  if (!rows.length) return null;
  const series = [
    { name: evName, values: rows.map((r) => r.n_ev) },
    rows[0].n_pep !== undefined ? { name: "peptides", values: rows.map((r) => r.n_pep) } : null,
    rows[0].n_prot !== undefined ? { name: "proteins", values: rows.map((r) => r.n_prot) } : null,
    rows[0].n_pg !== undefined ? { name: "protein groups", values: rows.map((r) => r.n_pg) } : null,
  ].filter(Boolean) as ChartSpec["series"];
  return { kind: "bar", labels: rows.map((r) => String(r.run_file_name)), series, xName: "run", hideLabels: rows.length > 30 };
}

/** log10 intensity distribution per sample (or per run × channel if unmapped). */
async function sampleBox(): Promise<ChartSpec | null> {
  return ev ? sampleIntensities(props.ds, props.t, ev) : null;
}

function runMedianSpec(key: "med_int" | "med_ppm", name: string): ChartSpec | null {
  const rows = runRows.value;
  if (!rows.length || rows[0][key] === undefined) return null;
  return {
    kind: "line",
    labels: rows.map((r) => String(r.run_file_name)),
    series: [{ name, values: rows.map((r) => (r[key] == null ? null : Number(r[key]))) }],
    xName: "run",
    hideLabels: rows.length > 30,
  };
}

async function build() {
  runBusy.value = true;
  try {
    await loadRuns();
  } catch (e: any) {
    runError.value = String(e?.message ?? e);
  } finally {
    runBusy.value = false;
  }
  run({
    runMetrics: async () => runMetricsSpec(),
    sampleBox,
    runInt: async () => runMedianSpec("med_int", "median log10 intensity"),
    runPpm: async () => runMedianSpec("med_ppm", "median ppm"),
  });
}

onMounted(() => {
  const psm = props.t.feature ? props.t.psm : undefined;
  check([{ ref: ev, cols: QC_EVIDENCE_COLUMNS }, { ref: psm, cols: QC_COUNT_COLUMNS }, { ref: props.t.pg, cols: QC_COUNT_COLUMNS }], build);
});
</script>

<template>
  <div>
    <div v-if="!ev" class="muted pad">No feature or PSM view in this dataset.</div>
    <LargeGate v-else-if="gate.blocked" :bytes="gate.bytes" :size="gate.size" what="Per-run QC" @go="release" />
    <div v-else-if="gate.error" class="error pad">⚠ {{ gate.error }}</div>
    <div v-else-if="gate.checking" class="muted pad"><span class="spinner"></span></div>
    <template v-else>
      <p class="muted note">
        <span v-if="runBusy || progress.running">Computing per-run QC… <span class="spinner"></span> · </span>
        Target {{ evName }} only. Runs are joined with the PSM, protein-group and run views when they exist.
      </p>
      <div class="grid">
        <ChartCard v-if="!slots.runMetrics.skip" wide title="Identifications per run" subtitle="Run order as in the run files." v-bind="slots.runMetrics" :file-base="fileBase" />
        <ChartCard v-if="!slots.runInt.skip" title="Median intensity per run" subtitle="Median log10 summed intensity — loading or sensitivity drift shows up here." v-bind="slots.runInt" :file-base="fileBase" :height="220" />
        <ChartCard v-if="!slots.runPpm.skip" title="Median mass error per run" subtitle="Median precursor mass error (ppm) — calibration drift shows up here." v-bind="slots.runPpm" :file-base="fileBase" :height="220" />
        <ChartCard v-if="!slots.sampleBox.skip" wide title="Per-sample intensity" subtitle="log10 intensity per sample (5–95% whiskers, box = quartiles). Samples come from the run view's channel map." v-bind="slots.sampleBox" :file-base="fileBase" :height="300" />
      </div>

      <div class="sec">
        <div class="sec-head">
          <h3>Runs <span class="muted">({{ runRows.length.toLocaleString() }})</span></h3>
          <button class="xs" :disabled="!runRows.length" @click="table?.exportCsv()">CSV</button>
        </div>
        <div v-if="runError" class="error">⚠ {{ runError }}</div>
        <div v-else-if="runBusy" class="muted"><span class="spinner"></span></div>
        <ReportTable v-else ref="table" :columns="runCols" :rows="runRows" :file-name="`${fileBase}_runs_qc`" max-height="480px" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 14px;
}
.note {
  font-size: 12px;
  margin: 0 0 12px;
}
.sec {
  margin-top: 18px;
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
h3 {
  margin: 0;
  font-size: 14px;
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
