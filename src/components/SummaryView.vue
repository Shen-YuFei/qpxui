<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VChart from "vue-echarts";
import { use } from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { ensureViewReady, describeTable, countRows, runSql, type ColumnInfo } from "../lib/duck";
import type { ViewInfo } from "../lib/api";
import { scanBytes, viewScale, type ViewScale } from "../lib/report";
import { fmtBytes } from "../lib/format";

use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

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
  scale.value ? scanBytes(scale.value, ["charge", "anchor_protein", "pg_accessions", "run_file_name", "peptide_qvalue", "posterior_error_probability", "missed_cleavages", numericCol.value]) : 0
);

const cards = ref<any[]>([]);
const numericCol = ref("");
const histOpt = computed<any>(() => (chart.value ? chart.value.option : null));
const chart = ref<any>({ option: null });

const numericCols = computed(() =>
  cols.value.filter((c) => isNumericScalar(c.type))
);

// Only treat columns whose *scalar base* type is numeric as histogrammable.
// Complex/nested types (MAP, LIST, ARRAY, STRUCT, ENUM, UNION) are rejected —
// previously a `MAP(VARCHAR, BIGINT)` column was matched because "BIGINT"
// contains "int", producing SQL that divides/subtracts MAPs and fails.
function isNumericScalar(type: string): boolean {
  const t = type.trim();
  if (/map|list|array|struct|union|enum|\[/i.test(t)) return false;
  const base = t.split(/[[(]/)[0].trim().toLowerCase();
  return [
    "tinyint", "smallint", "integer", "bigint", "hugeint",
    "utinyint", "usmallint", "uinteger", "ubigint", "uhugeint",
    "float", "real", "double", "decimal", "numeric",
  ].includes(base);
}

function barOption(labels: string[], values: number[], title: string) {
  return {
    title: { text: title, textStyle: { color: "#e2e8f0", fontSize: 13 } },
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

async function runCard(label: string, sql: string, key: string): Promise<any> {
  const r = await runSql(sql);
  const labels = r.rows.map((row) => String(row[0] ?? "∅"));
  const values = r.rows.map((row) => Number(row[1] ?? 0));
  return { label, key, option: barOption(labels, values, label) };
}

// QPX row unit for each view, used in chart titles.
const ROW_UNIT: Record<string, string> = { psm: "PSMs", feature: "features", pg: "protein groups" };
const unit = () => ROW_UNIT[props.view.view] ?? "rows";

async function buildSummaries() {
  busy.value = true;
  error.value = "";
  const t = table.value;
  const names = new Set(cols.value.map((c) => c.name.toLowerCase()));
  const list: any[] = [];
  const push = (c: any) => {
    if (c.option?.series?.[0]?.data?.length) list.push(c);
  };

  if (names.has("charge")) {
    push(await runCard("Charge distribution", `SELECT charge AS k, COUNT(*) AS n FROM "${t}" GROUP BY 1 ORDER BY 1`, "charge"));
  }
  if (names.has("anchor_protein") || names.has("pg_accessions")) {
    const col = names.has("anchor_protein") ? "anchor_protein" : "pg_accessions";
    push(await runCard(`Top ${col === "anchor_protein" ? "anchor proteins" : "protein groups"} by ${unit()}`, `SELECT ${col} AS k, COUNT(*) AS n FROM "${t}" WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 25`, "protein"));
  }
  if (names.has("run_file_name")) {
    push(await runCard(`${unit()[0].toUpperCase()}${unit().slice(1)} per run`, `SELECT run_file_name AS k, COUNT(*) AS n FROM "${t}" GROUP BY 1 ORDER BY 2 DESC LIMIT 25`, "run"));
  }
  if (names.has("peptide_qvalue") || names.has("posterior_error_probability")) {
    const col = names.has("peptide_qvalue") ? "peptide_qvalue" : "posterior_error_probability";
    push(await runCard(`${col} distribution`, `SELECT round(${col},2) AS k, COUNT(*) AS n FROM "${t}" WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 1`, "q"));
  }
  if (names.has("missed_cleavages")) {
    push(await runCard("Missed cleavages", `SELECT missed_cleavages AS k, COUNT(*) AS n FROM "${t}" GROUP BY 1 ORDER BY 1`, "mc"));
  }
  cards.value = list;
}

async function buildHistogram() {
  if (!numericCol.value) return;
  const col = numericCol.value;
  const t = table.value;
  const q = `
    WITH stats AS (
      SELECT min(${col}) AS mn, max(${col}) AS mx, abs(max(${col}) - min(${col}))/30.0 AS w
      FROM "${t}" WHERE ${col} IS NOT NULL
    )
    SELECT (floor((${col} - (SELECT mn FROM stats)) / NULLIF((SELECT w FROM stats),0)))::INT AS bin,
           COUNT(*) AS n
    FROM "${t}" WHERE ${col} IS NOT NULL
    GROUP BY 1 ORDER BY 1`;
  const r = await runSql(q);
  const labels = r.rows.map((row) => String(row[0] ?? ""));
  const values = r.rows.map((row) => Number(row[1] ?? 0));
  chart.value = { option: barOption(labels, values, `Histogram of ${col}`) };
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
  if (numericCol.value) {
    try {
      await buildHistogram();
    } catch (e) {
      // A numeric-ish column can still fail to histogram (e.g. extreme
      // values); don't let it take down the whole summary.
      console.warn("histogram skipped:", e);
    }
  }
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
      <div v-if="histOpt && chart.option" class="card wide">
        <VChart :option="histOpt" autoresize style="width: 100%; height: 300px" />
      </div>
      <div v-for="c in cards" :key="c.key" class="card">
        <VChart :option="c.option" autoresize style="width: 100%; height: 300px" />
      </div>
      <p v-if="!cards.length && !chart.option" class="muted pad">
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
