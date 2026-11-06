<script setup lang="ts">
import { computed, ref } from "vue";
import VChart from "vue-echarts";
import { buildOption, chartTheme, specToCsv, type ChartSpec } from "../lib/charts";
import { savePng, saveText } from "../lib/export";
import { settings } from "../lib/settings";

const props = defineProps<{
  title: string;
  subtitle?: string;
  spec?: ChartSpec | null;
  /** Ready-made ECharts option (heatmaps, scatter…) instead of a spec. */
  option?: any;
  /** CSV text for `option` charts. */
  csv?: () => string;
  loading?: boolean;
  error?: string;
  /** Prefix for exported file names (e.g. the dataset accession). */
  fileBase?: string;
  height?: number;
  wide?: boolean;
  /** Accepted so a slot object can be spread with v-bind; unused here. */
  skip?: boolean;
}>();

const chart = ref<InstanceType<typeof VChart> | null>(null);
const msg = ref("");

const option = computed(() => {
  // Re-read the CSS variables whenever the theme changes.
  void settings.theme;
  if (props.option) return props.option;
  return props.spec ? buildOption(props.spec, chartTheme()) : null;
});
const empty = computed(() => !props.option && !!props.spec && (!props.spec.labels.length || !props.spec.series.length));
const name = computed(() => `${props.fileBase ? props.fileBase + "_" : ""}${props.title}`);

function flash(text: string) {
  msg.value = text;
  window.setTimeout(() => (msg.value = ""), 2500);
}

async function exportPng() {
  const inst = (chart.value as any)?.chart;
  if (!inst) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-panel").trim() || "#fff";
  try {
    const p = await savePng(name.value, inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: bg }));
    if (p) flash("Saved");
  } catch (e) {
    flash(String(e));
  }
}

async function exportCsv() {
  const text = props.csv ? props.csv() : props.spec ? specToCsv(props.spec) : "";
  if (!text) return;
  try {
    const p = await saveText(name.value, text);
    if (p) flash("Saved");
  } catch (e) {
    flash(String(e));
  }
}
</script>

<template>
  <div class="card" :class="{ wide }">
    <div class="head">
      <div class="titles">
        <div class="title">{{ title }}</div>
        <div v-if="subtitle" class="sub muted">{{ subtitle }}</div>
      </div>
      <div class="acts">
        <span v-if="msg" class="muted msg">{{ msg }}</span>
        <slot name="actions" />
        <button class="xs" :disabled="!option || empty" title="Save chart as PNG" @click="exportPng">PNG</button>
        <button class="xs" :disabled="(!spec && !csv) || empty" title="Save chart data as CSV" @click="exportCsv">CSV</button>
      </div>
    </div>
    <div class="body" :style="{ height: (height ?? 260) + 'px' }">
      <div v-if="error" class="state error">⚠ {{ error }}</div>
      <div v-else-if="loading || (!spec && !option)" class="state muted"><span class="spinner"></span></div>
      <div v-else-if="empty" class="state muted">No data</div>
      <VChart v-else ref="chart" :option="option" autoresize class="chart" />
    </div>
  </div>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-panel);
  padding: 10px 12px 8px;
  min-width: 0;
}
.card.wide {
  grid-column: 1 / -1;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.title {
  font-weight: 600;
  font-size: 13px;
}
.sub {
  font-size: 11px;
  margin-top: 2px;
}
.acts {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-shrink: 0;
}
.msg {
  font-size: 11px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button.xs {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 6px;
}
.body {
  margin-top: 6px;
  position: relative;
}
.chart {
  width: 100%;
  height: 100%;
}
.state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  text-align: center;
  padding: 0 12px;
}
</style>
