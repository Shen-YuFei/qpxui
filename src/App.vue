<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { state, reset } from "./store";
import { applyTheme } from "./lib/settings";
import { init } from "./lib/duck";
import SourcePicker from "./components/SourcePicker.vue";
import DatasetExplorer from "./components/DatasetExplorer.vue";
import SettingsPanel from "./components/SettingsPanel.vue";

// Views and the report (with ECharts) load once a source is open, which keeps
// them out of the start-up bundle.
const ViewPanel = defineAsyncComponent(() => import("./components/ViewPanel.vue"));
const ReportView = defineAsyncComponent(() => import("./components/ReportView.vue"));

const hasData = computed(() => state.datasets.length > 0);
/** Short names of the source kinds; a portal source carries its own label. */
const SOURCE_LABELS: Record<string, string> = {
  "single-file": "Single file",
  collection: "Folder",
  s3: "S3",
};
const settingsOpen = ref(false);

onMounted(() => {
  applyTheme();
  // Compiling the engine's wasm takes seconds: start it while the user picks a
  // source. A failure resurfaces (and retries) at the first query.
  void init();
});

function newSource() {
  reset();
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="logo">QPX</span>
        <span class="title">data viewer</span>
      </div>
      <div class="actions">
        <span v-if="state.status" class="status">{{ state.status }}</span>
        <span v-if="state.sourceKind !== 'none'" class="source">{{ SOURCE_LABELS[state.sourceKind] ?? state.sourceKind }}</span>
        <button v-if="hasData" @click="newSource">New source</button>
        <button title="Settings" @click="settingsOpen = true">Settings</button>
      </div>
    </header>

    <SettingsPanel :open="settingsOpen" @close="settingsOpen = false" />

    <main class="body">
      <SourcePicker v-if="!hasData" />
      <template v-else>
        <aside class="sidebar">
          <DatasetExplorer />
        </aside>
        <section class="content">
          <ReportView
            v-if="state.page === 'report' && state.selectedDataset"
            :key="state.selectedDataset.path + state.selectedDataset.prefix"
            :ds="state.selectedDataset"
          />
          <ViewPanel v-else />
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 18px;
  background: var(--brand-ink);
  color: var(--on-dark);
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  font-weight: 700;
  font-size: 18px;
  color: #ffffff;
  letter-spacing: 0.02em;
}
.title {
  padding-left: 10px;
  border-left: 1px solid var(--on-dark-rule);
  color: var(--on-dark-muted);
  font-size: 15px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status,
.source {
  font-size: 13px;
  color: var(--on-dark-muted);
}
.source {
  padding-left: 10px;
  border-left: 1px solid var(--on-dark-rule);
}
.actions button {
  background: transparent;
  border-color: var(--on-dark-rule);
  color: #ffffff;
  padding: 5px 12px;
}
.actions button:hover:not(:disabled) {
  border-color: var(--on-dark-muted);
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 288px;
  min-width: 288px;
  border-right: 1px solid var(--border);
  background: var(--bg-alt);
  overflow: auto;
}
.content {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
</style>
