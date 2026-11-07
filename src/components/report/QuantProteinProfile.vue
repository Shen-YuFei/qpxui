<script setup lang="ts">
// The Quantification tab's protein list and the abundance profile of the
// protein picked in it.
import ChartCard from "../ChartCard.vue";
import ReportTable from "../ReportTable.vue";
import { listText } from "../../lib/format";
import { PROTEIN_LIST_MAX, type ProteinSummary } from "../../lib/quant";
import type { Column } from "../../lib/report";

defineProps<{
  /** The proteins listed (filtered by `q`). */
  rows: ProteinSummary[];
  /** The picked protein's row, null when the matrix lacks it. */
  focusRow: ProteinSummary | null;
  option: any;
  csv: () => string;
  /** Columns of the matrix, and what they are ("samples" or "runs"). */
  nCols: number;
  colUnit: string;
  groupBy: string;
  fileBase: string;
}>();
const focus = defineModel<string | null>("focus", { required: true });
const q = defineModel<string>("q", { required: true });

const protCols: Column[] = [
  { key: "protein", label: "Anchor protein" },
  { key: "gene", label: "Gene" },
  { key: "n", label: "Quantified in", num: true },
  { key: "mean", label: "Mean log2", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(2)) },
  { key: "sd", label: "SD log2", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(2)), title: "Standard deviation of log2 abundance across samples" },
];
</script>

<template>
  <div class="profile">
    <div class="left">
      <div class="sec-head">
        <h3>Proteins <span class="muted">({{ rows.length.toLocaleString() }}{{ rows.length === PROTEIN_LIST_MAX ? "+" : "" }})</span></h3>
        <input v-model="q" class="filter" placeholder="Filter accession or gene…" />
      </div>
      <ReportTable
        :columns="protCols"
        :rows="rows"
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
      :subtitle="focusRow ? `${focus} · quantified in ${focusRow.n} of ${nCols} ${colUnit}${groupBy ? ' · lines = group means' : ''}` : 'Pick a protein.'"
      :option="option"
      :csv="csv"
      :empty-text="focusRow ? '' : 'Pick a protein.'"
      :file-base="`${fileBase}_${focusRow?.gene ?? focus ?? ''}`"
      :height="420"
    />
  </div>
</template>

<style scoped>
@media (max-width: 1100px) {
  .profile {
    grid-template-columns: minmax(0, 1fr);
  }
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
</style>
