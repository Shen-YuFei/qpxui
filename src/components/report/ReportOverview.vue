<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import ChartCard from "../ChartCard.vue";
import type { DatasetInfo } from "../../lib/api";
import type { ChartSpec } from "../../lib/charts";
import {
  cachedSql,
  evidence,
  histogramData,
  histogramSql,
  ident,
  intensitySumExpr,
  log10Expr,
  proteinExpr,
  targetWhere,
  type DatasetTables,
} from "../../lib/report";
import { useSlots } from "../../lib/useSlots";
import { useLargeGate } from "../../lib/useLargeGate";
import LargeGate from "./LargeGate.vue";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string }>();

const KEYS = ["perRun", "charge", "length", "mc", "ppg", "ppm", "rt", "intensity", "pep", "qvalue"] as const;
const { slots, progress, run } = useSlots(KEYS);

const ev = evidence(props.t);
const evName = props.t.feature ? "features" : "PSMs";
const { gate, check, release, dispose } = useLargeGate();
onUnmounted(dispose);

async function counts(key: string, sql: string, xName: string, yName = evName): Promise<ChartSpec> {
  const r = await cachedSql(props.ds, key, sql);
  return {
    kind: "bar",
    labels: r.rows.map((x) => String(x[0] ?? "∅")),
    series: [{ name: yName, values: r.rows.map((x) => Number(x[1])) }],
    xName,
  };
}

async function hist(key: string, expr: string, where: string, xName: string, yName = evName, robust = false): Promise<ChartSpec | null> {
  const r = await cachedSql(props.ds, key, histogramSql(ev!.table, expr, where, 40, robust));
  const h = histogramData(r);
  return { kind: "bar", labels: h.labels, series: [{ name: yName, values: h.values }], xName };
}

onMounted(() => {
  if (!ev) {
    run({});
    return;
  }
  const T = ident(ev.table);
  const W = targetWhere(ev);
  const has = (c: string) => ev.cols.has(c);
  const prot = proteinExpr(ev);
  const isum = intensitySumExpr(ev);
  const cols = ["is_decoy", "run_file_name", "charge", "sequence", "peptidoform", "missed_cleavages", "anchor_protein",
    "protein_accessions", "pg_accessions", "mass_error_ppm", "rt", "intensities", "posterior_error_probability", "peptide_qvalue"];
  check([{ ref: ev, cols }], () => run({
    perRun: has("run_file_name")
      ? async () => {
          const r = await cachedSql(
            props.ds,
            "ov.perRun",
            `SELECT run_file_name, count(*) AS n FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`
          );
          return {
            kind: "line",
            labels: r.rows.map((x) => String(x[0] ?? "∅")),
            series: [{ name: evName, values: r.rows.map((x) => Number(x[1])) }],
            xName: `runs (${r.rows.length}), most first`,
            hideLabels: r.rows.length > 30,
            zeroBased: true,
          };
        }
      : undefined,
    charge: has("charge")
      ? () => counts("ov.charge", `SELECT charge, count(*) FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY 1`, "charge")
      : undefined,
    length: ev.seq !== "NULL"
      ? () =>
          counts(
            "ov.length",
            `SELECT length(${ev.seq}) AS len, count(*) FROM ${T} WHERE ${W} AND ${ev.seq} IS NOT NULL GROUP BY 1 ORDER BY 1`,
            "residues"
          )
      : undefined,
    mc: has("missed_cleavages")
      ? () => counts("ov.mc", `SELECT missed_cleavages, count(*) FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY 1`, "missed cleavages")
      : undefined,
    ppg: prot && ev.seq !== "NULL"
      ? async () => {
          const s = await counts(
            "ov.ppg",
            `SELECT least(n, 20) AS k, count(*) FROM (
               SELECT ${prot} AS p, count(DISTINCT ${ev.seq}) AS n FROM ${T}
               WHERE ${W} AND ${prot} IS NOT NULL GROUP BY 1
             ) GROUP BY 1 ORDER BY 1`,
            "peptides (20 = 20 or more)",
            "protein groups"
          );
          s.labels = s.labels.map((l) => (l === "20" ? "20+" : l));
          return s;
        }
      : undefined,
    ppm: has("mass_error_ppm") ? () => hist("ov.ppm", "mass_error_ppm", W, "ppm", evName, true) : undefined,
    rt: has("rt") ? () => hist("ov.rt", "rt / 60.0", W, "minutes") : undefined,
    intensity: isum ? () => hist("ov.int", log10Expr(isum), W, "log10 intensity") : undefined,
    pep: has("posterior_error_probability")
      ? () => hist("ov.pep", log10Expr("posterior_error_probability"), W, "log10 PEP", evName)
      : undefined,
    qvalue: has("peptide_qvalue")
      ? () => hist("ov.q", "peptide_qvalue", W, "peptide q-value", evName)
      : undefined,
  }));
});
</script>

<template>
  <div>
    <div v-if="!ev" class="muted pad">This dataset has no feature or PSM view, so there are no peptide-level distributions.</div>
    <LargeGate v-else-if="gate.blocked" :bytes="gate.bytes" :size="gate.size" what="Building the distributions" @go="release" />
    <div v-else-if="gate.error" class="error pad">⚠ {{ gate.error }}</div>
    <div v-else-if="gate.checking" class="muted pad"><span class="spinner"></span></div>
    <template v-else>
      <p class="muted note">
        <span v-if="progress.running">Computing statistics · {{ progress.done }} of {{ progress.total }} <span class="spinner"></span> · </span>
        Distributions cover the whole dataset (target {{ evName }}, decoys excluded). Per-run and per-sample quality is on the QC tab.
      </p>
      <div class="grid">
        <ChartCard v-if="!slots.perRun.skip" wide title="Identifications per run" :subtitle="`Target ${evName} in each run. Most first.`" v-bind="slots.perRun" :file-base="fileBase" />
        <ChartCard v-if="!slots.charge.skip" title="Precursor charge" :subtitle="`Target ${evName} by charge state.`" v-bind="slots.charge" :file-base="fileBase" />
        <ChartCard v-if="!slots.length.skip" title="Peptide length" :subtitle="`Target ${evName} by sequence length (residues).`" v-bind="slots.length" :file-base="fileBase" />
        <ChartCard v-if="!slots.mc.skip" title="Missed cleavages" :subtitle="`Target ${evName} by missed cleavages.`" v-bind="slots.mc" :file-base="fileBase" />
        <ChartCard v-if="!slots.ppg.skip" title="Peptides per protein group" subtitle="Protein groups by number of distinct peptides; 20 means 20 or more." v-bind="slots.ppg" :file-base="fileBase" />
        <ChartCard v-if="!slots.ppm.skip" title="Precursor mass error (ppm)" subtitle="Outliers beyond quartiles ± 3 IQR (e.g. isotope errors) are left out." v-bind="slots.ppm" :file-base="fileBase" />
        <ChartCard v-if="!slots.rt.skip" title="Retention time (min)" :subtitle="`Target ${evName} by retention time.`" v-bind="slots.rt" :file-base="fileBase" />
        <ChartCard v-if="!slots.intensity.skip" title="Feature intensity" subtitle="log10 of the intensity summed over channels." v-bind="slots.intensity" :file-base="fileBase" />
        <ChartCard v-if="!slots.pep.skip" title="Posterior error probability" subtitle="log10 PEP." v-bind="slots.pep" :file-base="fileBase" />
        <ChartCard v-if="!slots.qvalue.skip" title="Peptide q-value" subtitle="Central 99% of values." v-bind="slots.qvalue" :file-base="fileBase" />
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
.pad {
  padding: 18px;
}
</style>
