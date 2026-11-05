<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { state } from "../store";
import { api, type StreamStat, type ViewInfo } from "../lib/api";

const datasets = computed(() => state.datasets);

// For streamed S3 views, show how much of the object has actually been read.
const streamStats = ref<Record<string, StreamStat>>({});
let timer: number | undefined;
async function refreshStats() {
  if (!state.datasets.some((d) => d.views.some(isStreamed))) return;
  try {
    streamStats.value = await api.streamS3Stats();
  } catch {
    /* backend not ready */
  }
}
onMounted(() => {
  refreshStats();
  timer = window.setInterval(refreshStats, 1500);
});
onUnmounted(() => window.clearInterval(timer));

function isStreamed(v: ViewInfo): boolean {
  return /^(s3|https?):\/\//.test(v.path);
}

function streamTitle(v: ViewInfo): string {
  const s = streamStats.value[v.path];
  if (!s) return "Streamed (lazy) — not read yet";
  return `Streamed (lazy): ${fmt(s.fetchedBytes)} of ${fmt(s.sizeBytes)} fetched in ${s.requests} range request(s)`;
}

function fmt(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function selectView(v: ViewInfo) {
  state.selectedView = v;
}

function selectDataset(d: (typeof state.datasets)[number]) {
  state.selectedDataset = d;
  if (d.views.length) state.selectedView = d.views[0];
}

const viewIcon: Record<string, string> = {
  dataset: "🛰️",
  sample: "🧪",
  run: "⚙️",
  psm: "🎯",
  feature: "📐",
  pg: "🧬",
  pepmap: "🔗",
  mz: "📡",
  ontology: "🏷️",
  provenance: "📜",
  ae: "📊",
  de: "🔥",
};
</script>

<template>
  <div class="tree">
    <div class="tree-title">Datasets</div>

    <div v-for="d in datasets" :key="d.path + d.prefix" class="ds">
      <div
        class="ds-head"
        :class="{ active: state.selectedDataset === d }"
        @click="selectDataset(d)"
        title="Click to select dataset"
      >
        <span class="ds-name">{{ d.prefix }}</span>
        <button class="xs" @click.stop="selectDataset(d)">{{ d.views.length }}</button>
      </div>

      <div v-if="state.selectedDataset === d" class="views">
        <div
          v-for="v in d.views"
          :key="v.path"
          class="view"
          :class="{ active: state.selectedView?.path === v.path }"
          @click="selectView(v)"
          :title="`${v.name} · ${fmt(v.sizeBytes)}`"
        >
          <span class="vi">{{ viewIcon[v.view] ?? '📦' }}</span>
          <span class="vname mono">{{ v.view }}</span>
          <span v-if="isStreamed(v)" class="stream muted" :title="streamTitle(v)">
            ⚡ {{ fmt(streamStats[v.path]?.fetchedBytes ?? 0) }} /
          </span>
          <span class="vsize muted">{{ fmt(v.sizeBytes) }}</span>
          <span v-if="state.registered.has(v.path)" class="ok" title="Loaded in DuckDB">✓</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree {
  padding: 14px;
}
.tree-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-dim);
  margin-bottom: 12px;
}
.ds {
  margin-bottom: 8px;
}
.ds-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  background: var(--bg-panel);
  border: 1px solid transparent;
}
.ds-head:hover,
.ds-head.active {
  border-color: var(--accent);
}
.ds-name {
  font-weight: 700;
  font-size: 13px;
}
button.xs {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 999px;
  background: transparent;
}
.views {
  margin-left: 14px;
  border-left: 1px solid var(--border);
  padding-left: 8px;
  margin-top: 4px;
}
.view {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 12px;
}
.view:hover {
  background: var(--bg-panel);
}
.view.active {
  background: var(--bg-panel);
  color: var(--accent);
  border: 1px solid var(--border);
}
.vi {
  width: 16px;
}
.vname {
  flex: 1;
}
.vsize {
  font-size: 11px;
}
.stream {
  font-size: 10px;
  white-space: nowrap;
}
.ok {
  color: var(--ok);
  font-weight: 700;
}
</style>
