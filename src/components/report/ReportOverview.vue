<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import ChartCard from "../ChartCard.vue";
import type { DatasetInfo } from "../../lib/api";
import { evidence, type DatasetTables } from "../../lib/report";
import { OVERVIEW_CHARTS, OVERVIEW_COLUMNS, overviewCharts } from "../../lib/queries/overview";
import { useSlots } from "../../lib/useSlots";
import { useLargeGate } from "../../lib/useLargeGate";
import LargeGate from "./LargeGate.vue";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string }>();

const { slots, progress, run } = useSlots(OVERVIEW_CHARTS);

const ev = evidence(props.t);
const evName = props.t.feature ? "features" : "PSMs";
const { gate, check, release, dispose } = useLargeGate();
onUnmounted(dispose);

onMounted(() => {
  if (!ev) {
    run({});
    return;
  }
  check([{ ref: ev, cols: OVERVIEW_COLUMNS }], () => run(overviewCharts(props.ds, ev, evName)));
});
</script>

<template>
  <div>
    <div v-if="!ev" class="muted pad">This dataset has no feature or PSM view, so there are no peptide-level distributions.</div>
    <LargeGate v-else-if="gate.blocked" :bytes="gate.bytes" :size="gate.size" what="Building the distributions" @go="release" />
    <div v-else-if="gate.error" class="error pad">{{ gate.error }}</div>
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
