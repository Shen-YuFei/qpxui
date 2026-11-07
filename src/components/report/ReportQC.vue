<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import ChartCard from "../ChartCard.vue";
import ReportTable from "../ReportTable.vue";
import type { Column } from "../../lib/report";
import type { DatasetInfo } from "../../lib/api";
import type { ChartSpec } from "../../lib/charts";
import {
  cachedSql,
  evidence,
  ident,
  intensitySumExpr,
  objects,
  proteinExpr,
  targetWhere,
  type DatasetTables,
} from "../../lib/report";
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
  const T = ident(ev.table);
  const W = targetWhere(ev);
  const prot = proteinExpr(ev);
  const isum = intensitySumExpr(ev);
  const sel = [
    "run_file_name",
    `count(*)::BIGINT AS n_ev`,
    ev.seq !== "NULL" ? `count(DISTINCT ${ev.seq})::BIGINT AS n_pep` : null,
    prot ? `count(DISTINCT ${prot})::BIGINT AS n_prot` : null,
    isum ? `median(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS med_int` : null,
    ev.cols.has("mass_error_ppm") ? "median(mass_error_ppm) AS med_ppm" : null,
    ev.cols.has("rt") ? "median(rt) / 60.0 AS med_rt" : null,
    ev.cols.has("charge") ? "avg(charge) AS avg_charge" : null,
    ev.cols.has("missed_cleavages") ? "avg((missed_cleavages > 0)::INT) * 100 AS pct_mc" : null,
  ].filter(Boolean);
  const parts: string[] = [`ev AS (SELECT ${sel.join(", ")} FROM ${T} WHERE ${W} GROUP BY 1)`];
  const joins: string[] = [];
  const extra: string[] = [];
  const psm = props.t.psm;
  if (props.t.feature && psm?.cols.has("run_file_name")) {
    parts.push(`ps AS (SELECT run_file_name, count(*)::BIGINT AS n_psm FROM ${ident(psm.table)} WHERE ${targetWhere(psm)} GROUP BY 1)`);
    joins.push("LEFT JOIN ps USING (run_file_name)");
    extra.push("ps.n_psm");
  }
  const pg = props.t.pg;
  if (pg?.cols.has("run_file_name")) {
    parts.push(`pgc AS (SELECT run_file_name, count(*)::BIGINT AS n_pg FROM ${ident(pg.table)} WHERE ${targetWhere(pg)} GROUP BY 1)`);
    joins.push("LEFT JOIN pgc USING (run_file_name)");
    extra.push("pgc.n_pg");
  }
  const rv = props.t.run;
  if (rv?.cols.has("run_file_name")) {
    const rsel = ["run_file_name"];
    if (rv.cols.has("instrument")) { rsel.push("instrument"); extra.push("r.instrument"); }
    if (rv.cols.has("fraction")) { rsel.push("fraction"); extra.push("r.fraction"); }
    if (rv.cols.has("samples")) { rsel.push("len(samples) AS n_samples"); extra.push("r.n_samples"); }
    parts.push(`r AS (SELECT ${rsel.join(", ")} FROM ${ident(rv.table)})`);
    joins.push("LEFT JOIN r USING (run_file_name)");
  }
  const sql = `WITH ${parts.join(",\n")}
SELECT ev.*${extra.length ? ", " + extra.join(", ") : ""} FROM ev ${joins.join(" ")} ORDER BY run_file_name`;
  const res = await cachedSql(props.ds, "qc.runs", sql);
  const rows = objects(res);
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
  runCols.value = all.filter((c) => res.columns.includes(c.key));
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
  if (!ev || !ev.cols.has("intensities") || !ev.cols.has("run_file_name")) return null;
  const rv = props.t.run;
  const mapped = !!rv?.cols.has("samples") && rv.cols.has("run_file_name");
  const sampleExpr = mapped ? "coalesce(m.sample_accession, i.run_file_name || ' · ' || i.label)" : "i.run_file_name || ' · ' || i.label";
  const sql = `
WITH i AS (
  SELECT run_file_name, u.label AS label, u.intensity AS intensity
  FROM (SELECT run_file_name, unnest(intensities) AS u FROM ${ident(ev.table)} WHERE ${targetWhere(ev)})
  WHERE u.intensity > 0
)${mapped ? `,
m AS (SELECT run_file_name, s.sample_accession AS sample_accession, s.label AS label
      FROM (SELECT run_file_name, unnest(samples) AS s FROM ${ident(rv!.table)}))` : ""}
SELECT ${sampleExpr} AS smp, count(*)::BIGINT AS n,
       quantile_cont(log10(i.intensity), [0.05, 0.25, 0.5, 0.75, 0.95]) AS q
FROM i ${mapped ? "LEFT JOIN m ON m.run_file_name = i.run_file_name AND m.label = i.label" : ""}
GROUP BY 1 ORDER BY 1 LIMIT 400`;
  const r = await cachedSql(props.ds, "qc.samples", sql);
  const rows = objects(r);
  // Natural sort so Sample-2 comes before Sample-10.
  rows.sort((a, b) => String(a.smp).localeCompare(String(b.smp), undefined, { numeric: true }));
  return {
    kind: "box",
    labels: rows.map((x) => String(x.smp)),
    series: [{ name: "log10 intensity", values: rows.map((x) => (x.q as number[]).map(Number)) }],
    xName: mapped ? "sample" : "run · channel",
    hideLabels: rows.length > 40,
  };
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
  const evCols = ["is_decoy", "run_file_name", "sequence", "peptidoform", "anchor_protein", "protein_accessions", "pg_accessions",
    "intensities", "mass_error_ppm", "rt", "charge", "missed_cleavages"];
  const psm = props.t.feature ? props.t.psm : undefined;
  check([{ ref: ev, cols: evCols }, { ref: psm, cols: ["is_decoy", "run_file_name"] }, { ref: props.t.pg, cols: ["is_decoy", "run_file_name"] }], build);
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
