<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { hasReport, openReport, searchFor, state, stopQueries } from "../store";
import { api, type StreamStat, type ViewInfo } from "../lib/api";
import { registered } from "../lib/duck";
import { fmtBytes } from "../lib/format";

const datasets = computed(() => state.datasets);

// For streamed S3 views, show how much of the object has actually been read.
const streamStats = ref<Record<string, StreamStat>>({});
let timer: number | undefined;
async function refreshStats() {
  if (!state.datasets.some((d) => d.views.some(isStreamed))) return;
  streamStats.value = await api.streamS3Stats();
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
  return `Streamed (lazy): ${fmtBytes(s.fetchedBytes)} of ${fmtBytes(s.sizeBytes)} fetched in ${s.requests} range request(s)`;
}


function selectView(v: ViewInfo) {
  state.selectedView = v;
  state.page = "view";
}

function selectDataset(d: (typeof state.datasets)[number]) {
  if (state.selectedDataset !== d) {
    state.proteinFocus = null;
    stopQueries();
  }
  state.selectedDataset = d;
  if (d.views.length) state.selectedView = d.views[0];
  state.page = hasReport(d) ? "report" : "view";
}

// ---- search box (searches the selected dataset) ----
const q = ref("");
const scope = ref<"proteins" | "peptides">("proteins");
function runSearch() {
  const s = q.value.trim();
  // An upper-case amino-acid string of 8+ residues is a peptide, not a gene.
  const sc = /^[ACDEFGHIKLMNPQRSTVWY]{8,}$/.test(s) ? "peptides" : scope.value;
  scope.value = sc;
  searchFor(sc, s);
}
</script>

<template>
  <div class="tree">
    <form v-if="hasReport(state.selectedDataset)" class="search" @submit.prevent="runSearch">
      <input v-model="q" placeholder="Search protein, gene or peptide sequence…" title="Searches the selected dataset" />
      <div class="scope">
        <label><input v-model="scope" type="radio" value="proteins" /> Proteins</label>
        <label><input v-model="scope" type="radio" value="peptides" /> Peptidoforms</label>
        <button type="submit" class="xs go">Search</button>
      </div>
    </form>

    <div v-if="state.scanWarnings.length" class="scan-warning error">
      Skipped unreadable folders:
      <div v-for="folder in state.scanWarnings" :key="folder.path" :title="folder.reason">{{ folder.path }}</div>
    </div>
    <div class="tree-title">Datasets</div>

    <div v-for="d in datasets" :key="d.path + d.prefix" class="ds">
      <div
        class="ds-head"
        :class="{ active: state.selectedDataset === d }"
        @click="selectDataset(d)"
        title="Click to select dataset"
      >
        <span class="ds-name">{{ d.prefix }}</span>
        <span class="ds-count muted" :title="`${d.views.length} views`">{{ d.views.length }}</span>
      </div>

      <div v-if="state.selectedDataset === d" class="views">
        <div
          v-if="hasReport(d)"
          class="view report-link"
          :class="{ active: state.page === 'report' }"
          @click="openReport()"
          title="Dataset report: KPIs, QC charts, PTMs, samples, protein and peptidoform search"
        >
          <span class="vname">Report &amp; search</span>
        </div>
        <div
          v-for="v in d.views"
          :key="v.path"
          class="view"
          :class="{ active: state.page === 'view' && state.selectedView?.path === v.path }"
          @click="selectView(v)"
          :title="`${v.name} · ${fmtBytes(v.sizeBytes)}`"
        >
          <span class="vname mono">{{ v.view }}</span>
          <span v-if="isStreamed(v)" class="stream muted" :title="streamTitle(v)">
            {{ fmtBytes(streamStats[v.path]?.fetchedBytes ?? 0) }} /
          </span>
          <span class="vsize muted">{{ fmtBytes(v.sizeBytes) }}</span>
          <span v-if="registered.has(v.path)" class="ok" title="Loaded in DuckDB">✓</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree {
  padding: 16px 14px;
}
.scan-warning {
  margin-bottom: 12px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.tree-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  margin: 4px 0 8px;
}
.ds {
  margin-bottom: 2px;
}
.ds-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-left: 3px solid transparent;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
}
.ds-head:hover {
  background: var(--hover);
}
.ds-head.active {
  border-left-color: var(--accent);
  background: var(--bg-panel);
}
.ds-name {
  font-weight: 600;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.ds-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.views {
  margin: 2px 0 8px 13px;
  border-left: 1px solid var(--border);
}
.view {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-dim);
}
.view:hover {
  background: var(--hover);
  color: var(--text);
}
.view.active {
  color: var(--accent);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--accent);
  background: var(--bg-panel);
}
.vname {
  flex: 1;
}
.view .vname.mono {
  font-size: 12.5px;
}
.vsize {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.stream {
  font-size: 11px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.search {
  margin-bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.search > input {
  width: 100%;
  font-size: 13px;
}
.scope {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-dim);
}
.scope label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.scope input {
  margin: 0;
}
.go {
  margin-left: auto;
}
.report-link .vname {
  font-weight: 600;
  color: var(--text);
}
.report-link.active .vname {
  color: var(--accent);
}
.ok {
  color: var(--ok);
  font-size: 12px;
}
</style>
