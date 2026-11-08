<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VChart from "vue-echarts/csp";
import { ensureViewReady, describeTable, countRows, type ColumnInfo } from "../lib/duck";
import type { ViewInfo } from "../lib/api";
import { scanBytes, viewScale, type ViewScale } from "../lib/report";
import { columnHistogram, isNumericScalar, summaryCounts } from "../lib/queries/summary";
import { chartTheme } from "../lib/charts";
import { fmtBytes } from "../lib/format";
import { COL } from "../lib/qpx";

const props = defineProps<{ view: ViewInfo }>();
const table = ref("");
const cols = ref<ColumnInfo[]>([]);
const total = ref(0);
const error = ref("");
const busy = ref(true);
// Large streamed views: charts read whole columns, so wait for a click.
const scale = ref<ViewScale | null>(null);
const held = ref(false);
const heldBytes = computed(() =>
  scale.value ? scanBytes(scale.value, [COL.charge, COL.anchor_protein, COL.pg_accessions, COL.run_file_name, COL.peptide_qvalue, COL.posterior_error_probability, COL.missed_cleavages, numericCol.value]) : 0
);

const cards = ref<any[]>([]);
const numericCol = ref("");
const hist = ref<any>(null);
const histError = ref("");

const numericCols = computed(() =>
  cols.value.filter((c) => isNumericScalar(c.type))
);

function barOption(labels: string[], values: number[], title: string) {
  return {
    title: { text: title, textStyle: { color: chartTheme().text, fontSize: 13 } },
    tooltip: { trigger: "axis" },
    grid: { left: 50, right: 16, top: 44, bottom: 30 },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: "#94a3b8", rotate: labels.length > 8 ? 40 : 0 },
    },
    yAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
    series: [{ type: "bar", data: values, itemStyle: { color: "#22d3ee" }, barMaxWidth: 28 }],
  };
}

// QPX row unit for each view, used in chart titles.
const ROW_UNIT: Record<string, string> = { psm: "PSMs", feature: "features", pg: "protein groups" };
const unit = () => ROW_UNIT[props.view.view] ?? "rows";

async function buildSummaries() {
  busy.value = true;
  error.value = "";
  const names = new Set(cols.value.map((c) => c.name.toLowerCase()));
  const list = await summaryCounts(table.value, names, unit());
  cards.value = list.map((c) => ({ label: c.label, key: c.key, option: barOption(c.labels, c.values, c.label) }));
}

async function buildHistogram() {
  if (!numericCol.value) return;
  const col = numericCol.value;
  hist.value = null;
  histError.value = "";
  try {
    const r = await columnHistogram(table.value, col);
    hist.value = barOption(r.labels, r.values, `Histogram of ${col}`);
  } catch (e: any) {
    // A numeric column can still fail to histogram (e.g. infinite values):
    // say why in its place and keep the other charts.
    histError.value = String(e?.message ?? e);
  }
}

onMounted(async () => {
  try {
    table.value = await ensureViewReady(props.view);
    cols.value = await describeTable(table.value);
    numericCol.value = numericCols.value[0]?.name ?? "";
    if (/^(s3|https?):\/\//.test(props.view.path)) {
      scale.value = await viewScale({ view: props.view, table: table.value });
    }
    if (scale.value?.large) {
      total.value = scale.value.rows;
      held.value = true;
      return;
    }
    total.value = await countRows(table.value);
    await buildAll();
  } catch (e: any) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
});

async function computeHeld() {
  held.value = false;
  busy.value = true;
  try {
    await buildAll();
  } catch (e: any) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function buildAll() {
  await buildSummaries();
  await buildHistogram();
}
</script>

<template>
  <div class="summary">
    <div class="hdr">
      <div>
        <strong>{{ view.view }}</strong>
        <span class="muted"> · {{ total.toLocaleString() }} rows</span>
      </div>
      <div v-if="numericCols.length" class="pick">
        <label>Histogram column</label>
        <select v-model="numericCol" :disabled="held" @change="buildHistogram">
          <option v-for="c in numericCols" :key="c.name" :value="c.name">{{ c.name }}</option>
        </select>
      </div>
      <button v-if="!held" @click="buildSummaries" :disabled="busy">Refresh</button>
    </div>

    <div v-if="error" class="error pad">⚠ {{ error }}</div>
    <div v-else-if="busy" class="pad muted">Summarising… <span class="spinner"></span></div>
    <div v-else-if="held" class="pad held">
      <p>
        This view is streamed and large ({{ fmtBytes(scale!.bytes) }}). The summary charts read whole columns,
        at least <b>{{ fmtBytes(heldBytes) }}</b> over the network, so they are not built automatically.
      </p>
      <button class="primary" @click="computeHeld">Build charts (≥ {{ fmtBytes(heldBytes) }})</button>
    </div>

    <div class="cards" v-else>
      <div v-if="hist" class="card wide">
        <VChart :option="hist" autoresize style="width: 100%; height: 300px" />
      </div>
      <div v-else-if="histError" class="card wide error pad">⚠ No histogram of {{ numericCol }}: {{ histError }}</div>
      <div v-for="c in cards" :key="c.key" class="card">
        <VChart :option="c.option" autoresize style="width: 100%; height: 300px" />
      </div>
      <p v-if="!cards.length && !hist && !histError" class="muted pad">
        No obvious categorical/numeric columns to summarise for this view. Try the Query tab.
      </p>
    </div>
  </div>
</template>

<style scoped>
.summary {
  padding: 16px 18px;
}
.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.held {
  border: 1px dashed var(--border);
  border-radius: 8px;
  font-size: 13px;
}
.held p {
  margin: 0 0 10px;
}
.pick {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.pick select {
  max-width: 240px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 14px;
}
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-panel);
  padding: 10px;
}
.card.wide {
  grid-column: 1 / -1;
}
.pad {
  padding: 18px;
}
</style>
