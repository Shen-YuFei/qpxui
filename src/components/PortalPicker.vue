<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type DatasetInfo, type PortalDataset, type ViewInfo } from "../lib/api";
import { loadDatasets } from "../store";
import { installProgress, overall, progress } from "../lib/progress";

const rows = ref<PortalDataset[]>([]);
const selected = ref<PortalDataset | null>(null);
const query = ref("");
const views = ref<ViewInfo[]>([]);
const checked = ref<Record<string, boolean>>({});
const busy = ref(false);
const error = ref("");
const downloading = ref(false);
const downloadId = ref("");

function generateId(): string {
  return crypto?.randomUUID?.() ?? `d${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function isCancelledErr(e: unknown): boolean {
  return /cancell?/i.test(String(e));
}
function clearProgressFor(files: string[]) {
  for (const f of files) delete progress[f];
}
async function cancel() {
  if (!downloadId.value) return;
  try {
    await api.cancelDownload(downloadId.value);
  } catch {
    /* already finished — fine */
  }
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) =>
    [r.accession, r.title, r.organism, r.instrument]
      .filter(Boolean)
      .some((s) => (s as string).toLowerCase().includes(q))
  );
});

const selectedCount = computed(
  () => views.value.filter((v) => checked.value[v.path]).length
);

async function loadRegistry() {
  busy.value = true;
  error.value = "";
  try {
    rows.value = await api.portalRegistry();
    // Pre-select the first dataset so the view list shows out of the box.
    await selectDataset(rows.value[0] ?? null);
  } catch (e: any) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function selectDataset(ds: PortalDataset | null) {
  selected.value = ds;
  views.value = [];
  checked.value = {};
  if (!ds) return;
  busy.value = true;
  error.value = "";
  try {
    // Prefer the resolved run ref; fall back to the bare code (which the
    // backend resolves by scanning the run sub-folders).
    const ref = ds.datasetRef ?? ds.accession;
    views.value = await api.portalListViews(ref);
  } catch (e: any) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function loadSelection() {
  if (!selected.value) return;
  busy.value = true;
  downloading.value = true;
  error.value = "";
  const sel = views.value.filter((v) => checked.value[v.path]);
  try {
    if (!sel.length) throw new Error("Select at least one view to load.");
    const files = sel.map((v) => v.name);
    downloadId.value = generateId();
    try {
      const local = await api.portalCacheViews(sel.map((v) => v.path), downloadId.value);
      const ds: DatasetInfo = {
        prefix: selected.value.accession,
        path: `quantms portal / ${selected.value.accession}`,
        views: local.sort((a, b) => a.view.localeCompare(b.view)),
        sourceKind: "portal",
      };
      loadDatasets([ds], "portal | " + selected.value.accession);
    } catch (e: any) {
      if (isCancelledErr(e)) {
        error.value = "Transfer cancelled.";
        clearProgressFor(files);
      } else {
        throw e;
      }
    } finally {
      downloadId.value = "";
    }
  } catch (e: any) {
    error.value = String(e);
  } finally {
    busy.value = false;
    downloading.value = false;
  }
}

function toggleAll() {
  const allOn = views.value.every((v) => checked.value[v.path]);
  for (const v of views.value) checked.value[v.path] = !allOn;
}

function fmt(n: number | null | undefined, force?: boolean): string {
  if (!n) return force === undefined ? "—" : "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

onMounted(() => {
  installProgress();
  loadRegistry();
});

const activeBars = computed(() =>
  Object.entries(progress)
    .filter(([, b]) => b.phase === "downloading")
    .map(([name, b]) => ({ name, ...b }))
);
const overallPct = computed(() => overall());

function pct(n: number): string {
  return `${Math.max(0, Math.min(100, n)).toFixed(0)}%`;
}

function fmtPx(n: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}
</script>

<template>
  <div class="portal">
    <h3>Quantms portal — dataset registry</h3>
    <p class="muted">
      Browse, search, and open reanalysed datasets published on the
      <a href="https://portal.quantms.org" target="_blank" rel="noopener">quantms portal</a>.
      Sources load over HTTPS (no AWS credentials needed); the views you choose are
      downloaded once to your local cache, then queryable offline.
    </p>

    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="busy && !rows.length" class="muted">
      Loading dataset registry… <span class="spinner"></span>
    </div>

    <div v-if="rows.length" class="layout">
      <!-- Left: searchable registry -->
      <div class="registry">
        <input
          v-model="query"
          class="search"
          type="search"
          placeholder="Search datasets (accession, title, organism, instrument)…"
        />
        <div class="meta muted">
          {{ filtered.length }} of {{ rows.length }} datasets · {{ selected?.accession ?? "none" }} selected
        </div>
        <div class="rows">
          <button
            v-for="r in filtered"
            :key="r.accession"
            class="row"
            :class="{ active: selected?.accession === r.accession }"
            @click="selectDataset(r)"
          >
            <div class="row-top">
              <span class="mono acc">{{ r.accession }}</span>
              <span class="muted size" v-if="r.totalSize">{{ fmt(r.totalSize) }}</span>
            </div>
            <div class="title">{{ r.title || "—" }}</div>
            <div class="muted sub" v-if="r.organism || r.instrument">
              <span v-if="r.organism">{{ r.organism }}</span>
              <template v-if="r.organism && r.instrument"> · </template>
              <span v-if="r.instrument">{{ r.instrument }}</span>
              <template v-if="r.samples"> · {{ r.samples }} samples</template>
            </div>
          </button>
          <div v-if="!filtered.length" class="muted empty">No datasets match “{{ query }}”.</div>
        </div>
      </div>

      <!-- Right: selected dataset's views -->
      <div class="detail">
        <template v-if="selected">
          <div class="detail-head">
            <div class="mono acc">{{ selected.accession }}</div>
            <div class="title">{{ selected.title || selected.accession }}</div>
            <div class="muted" v-if="selected.organism || selected.instrument || selected.samples">
              <span v-if="selected.organism">{{ selected.organism }}</span>
              <span v-if="selected.instrument"> · {{ selected.instrument }}</span>
              <span v-if="selected.samples"> · {{ selected.samples }} samples</span>
              <span v-if="selected.proteins"> · {{ selected.proteins }} proteins</span>
            </div>
          </div>

          <div v-if="views.length" class="toolbar">
            <span class="muted">{{ views.length }} view(s) · {{ selectedCount }} selected</span>
            <button class="primary" @click="loadSelection" :disabled="busy || !selectedCount">
              {{ downloading ? "Downloading…" : "Load selected (download to cache)" }}
            </button>
          </div>

          <div v-if="downloading && activeBars.length" class="progress-box">
            <div class="overall">
              <span class="muted">Transferring to cache…</span>
              <span class="right">
                <span class="muted">{{ overallPct !== null ? pct(overallPct) : "" }}</span>
                <button class="cancel" @click="cancel" :disabled="!downloadId">Cancel</button>
              </span>
            </div>
            <div class="bar"><div class="fill" :style="{ width: pct(overallPct ?? 0) }"></div></div>
            <div v-for="b in activeBars" :key="b.file" class="file-bar">
              <div class="file-row">
                <span class="mono file-name">{{ b.file }}</span>
                <span class="muted">{{ fmtPx(b.done) }} / {{ b.total ? fmtPx(b.total) : "…" }} · {{ pct(b.percent) }}</span>
              </div>
              <div class="bar"><div class="fill" :style="{ width: pct(b.percent) }"></div></div>
            </div>
          </div>

          <div class="view-list" v-if="views.length">
            <label class="all">
              <input
                type="checkbox"
                :checked="selectedCount === views.length"
                @change="toggleAll"
              />
              <span>All views</span>
            </label>
            <label v-for="v in views" :key="v.path" class="view">
              <input v-model="checked[v.path]" type="checkbox" />
              <span class="mono view-name">{{ v.name }}</span>
              <span class="muted">{{ fmt(v.sizeBytes, true) }}</span>
            </label>
          </div>
          <div v-else-if="busy" class="muted">Loading views… <span class="spinner"></span></div>
          <div v-else class="muted">No QPX views listed for this dataset.</div>
        </template>
        <div v-else class="muted">Select a dataset from the registry.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.portal {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  background: var(--bg-panel);
}
h3 {
  margin: 0 0 6px;
}
a {
  color: var(--accent);
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 18px;
  margin-top: 16px;
}
.registry {
  display: flex;
  flex-direction: column;
  min-height: 320px;
  max-height: 560px;
}
.search {
  width: 100%;
}
.meta {
  margin: 8px 0;
  font-size: 12px;
}
.rows {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  text-align: left;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
}
.row:hover {
  background: var(--bg-soft);
  border-color: var(--border);
}
.row.active {
  background: var(--bg-soft);
  border-color: var(--accent);
}
.row-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.acc {
  font-weight: 600;
  color: var(--accent);
}
.size {
  font-size: 11px;
  white-space: nowrap;
}
.title {
  font-size: 12px;
  color: var(--text);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sub {
  font-size: 11px;
}
.empty {
  padding: 12px;
  font-size: 12px;
}
.detail {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  min-height: 320px;
  max-height: 560px;
  overflow-y: auto;
}
.detail-head {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 10px;
}
.detail-head .title {
  font-size: 14px;
  -webkit-line-clamp: 3;
  margin: 4px 0;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 10px 0;
  font-size: 13px;
  gap: 10px;
  flex-wrap: wrap;
}
.view-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.all {
  font-weight: 600;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 2px;
  cursor: pointer;
  display: flex;
  gap: 10px;
  align-items: center;
}
.view {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  cursor: pointer;
}
.view-name {
  flex: 1;
}
.progress-box {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin: 10px 0;
  background: var(--bg-soft);
}
.overall,
.file-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}
.right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.cancel {
  padding: 3px 12px;
  font-size: 12px;
  border-color: #d33;
  color: #d33;
}
.file-name {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar {
  height: 8px;
  background: var(--border);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 10px;
}
.fill {
  height: 100%;
  background: var(--accent);
  border-radius: 6px;
  transition: width 0.15s linear;
}
.file-bar:last-child .bar {
  margin-bottom: 0;
}
</style>
