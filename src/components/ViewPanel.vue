<script setup lang="ts">
import { ref, watch } from "vue";
import { state } from "../store";
import { ensureViewReady } from "../lib/duck";
import { isCancelled } from "../lib/errors";
import DataTable from "./DataTable.vue";
import SummaryView from "./SummaryView.vue";
import QueryView from "./QueryView.vue";

const tab = ref<"browse" | "summary" | "query">("browse");
const ready = ref<Record<string, boolean>>({});
const loadingView = ref(false);
const error = ref("");

let seq = 0;
async function activate() {
  const view = state.selectedView;
  if (!view) return;
  const my = ++seq;
  tab.value = "browse";
  loadingView.value = true;
  error.value = "";
  try {
    await ensureViewReady(view);
    if (my !== seq) return; // switched away while we were opening
    ready.value[view.path] = true;
  } catch (e: any) {
    if (my !== seq) return;
    // A switch abandoned this open; don't show "cancelled" over the new view.
    if (isCancelled(e)) return;
    error.value = String(e);
  } finally {
    if (my === seq) loadingView.value = false;
  }
}

watch(() => state.selectedView?.path, activate, { immediate: true });
</script>

<template>
  <div class="panel">
    <div v-if="state.selectedView" class="panel-head">
      <div>
        <div class="title mono">{{ state.selectedView.name }}</div>
        <div class="muted sub">dataset: {{ state.selectedDataset?.prefix }} · {{ state.selectedView.path }}</div>
      </div>
      <nav class="tabs">
        <button :class="{ active: tab === 'browse' }" @click="tab = 'browse'">Browse</button>
        <button :class="{ active: tab === 'summary' }" @click="tab = 'summary'">Summary</button>
        <button :class="{ active: tab === 'query' }" @click="tab = 'query'">Query</button>
      </nav>
    </div>

    <div v-if="error" class="error pad">{{ error }}</div>
    <div v-else-if="loadingView" class="pad muted">Loading view into DuckDB… <span class="spinner"></span></div>
    <div v-else-if="!state.selectedView" class="pad muted">Select a view from the left sidebar.</div>
    <template v-else>
      <DataTable v-if="tab === 'browse'" :key="state.selectedView.path" :view="state.selectedView" />
      <SummaryView v-else-if="tab === 'summary'" :key="state.selectedView.path" :view="state.selectedView" />
      <QueryView v-else :key="state.selectedView.path" :view="state.selectedView" />
    </template>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.panel-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px 0;
  border-bottom: 1px solid var(--border);
}
.panel-head > div {
  padding-bottom: 10px;
  min-width: 0;
}
.title {
  font-size: 16px;
  font-weight: 500;
}
.sub {
  font-size: 12px;
  max-width: 60vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Underlined tabs, as on the report page. */
.tabs {
  display: flex;
  gap: 4px;
}
.tabs button {
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 8px 14px 9px;
  color: var(--text-dim);
  border-bottom: 3px solid transparent;
  margin-bottom: -1px;
}
.tabs button:hover:not(:disabled) {
  color: var(--accent);
}
.tabs button.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.pad {
  padding: 18px;
}
</style>
