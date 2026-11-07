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
        <span class="title">Quantitative Proteomics eXchange · Viewer</span>
      </div>
      <div class="actions">
        <span v-if="state.status" class="muted status">{{ state.status }}</span>
        <span v-if="state.sourceKind !== 'none'" class="badge">{{ state.sourceKind }}</span>
        <button v-if="hasData" @click="newSource">New source</button>
        <button class="gear" title="Settings" @click="settingsOpen = true">⚙ Settings</button>
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
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  font-weight: 800;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 13px;
  letter-spacing: 1px;
}
.title {
  font-weight: 500;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status {
  font-size: 12px;
}
.badge {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: var(--accent-2);
  color: #10142b;
  border-radius: 999px;
  padding: 3px 10px;
  font-weight: 700;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 300px;
  min-width: 300px;
  border-right: 1px solid var(--border);
  background: var(--bg-soft);
  overflow: auto;
}
.content {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
</style>
