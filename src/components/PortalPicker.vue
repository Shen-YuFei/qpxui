<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, portalRef, type DatasetInfo, type PortalDataset, type ViewInfo } from "../lib/api";
import { loadDatasets } from "../store";
import { confirmDownload, totalBytes, useDownload } from "../lib/downloads";
import { fmtCount, fmtSize } from "../lib/format";
import DownloadProgress from "./DownloadProgress.vue";
import { REGISTRY_SORTS as SORTS, filterRegistry, nextSort, type RegistrySort } from "../lib/registry";

const rows = ref<PortalDataset[]>([]);
const selected = ref<PortalDataset | null>(null);
const query = ref("");
const views = ref<ViewInfo[]>([]);
const checked = ref<Record<string, boolean>>({});
const busy = ref(false);
const error = ref("");
const downloading = ref(false);
const { id: downloadId, cancelling, files: downloadFiles, cancel, run: runDownload, unmounted } = useDownload();

const sortKey = ref<RegistrySort>("accession");
const sortDesc = ref(false);

function setSort(k: RegistrySort) {
  const s = nextSort({ key: sortKey.value, desc: sortDesc.value }, k);
  sortKey.value = s.key;
  sortDesc.value = s.desc;
}

const filtered = computed(() => filterRegistry(rows.value, query.value, sortKey.value, sortDesc.value));

const selectedCount = computed(
  () => views.value.filter((v) => checked.value[v.path]).length
);
const selectedBytes = computed(() => totalBytes(views.value.filter((v) => checked.value[v.path])));

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
  // Picking another dataset abandons the running download.
  if (downloadId.value && ds !== selected.value) cancel();
  selected.value = ds;
  views.value = [];
  checked.value = {};
  if (!ds) return;
  busy.value = true;
  error.value = "";
  try {
    const v = await api.portalListViews(portalRef(ds), ds.organism, ds.psmCount);
    // A slower reply for an earlier click must not replace the current list.
    if (selected.value === ds) views.value = v;
  } catch (e: any) {
    if (selected.value === ds) error.value = String(e);
  } finally {
    if (selected.value === ds) busy.value = false;
  }
}

async function loadSelection() {
  if (!selected.value) return;
  busy.value = true;
  downloading.value = true;
  error.value = "";
  const sel = views.value.filter((v) => checked.value[v.path]);
  const target = selected.value;
  try {
    if (!(await confirmDownload(sel, "portal"))) return;
    // The user may have left this dataset or source while the dialog was
    // open; don't start a transfer for a dataset they've already moved on from.
    if (unmounted() || selected.value !== target) return;
    const local = await runDownload((id) => api.portalCacheViews(sel.map((v) => v.path), id));
    // Left meanwhile (which also cancels): say nothing there.
    if (unmounted() || selected.value !== target) return;
    if (!local) {
      error.value = "Download cancelled; partial files were removed.";
      return;
    }
    const ds: DatasetInfo = {
      prefix: target.accession,
      path: `quantms portal / ${portalRef(target)}`,
      views: local.sort((a, b) => a.view.localeCompare(b.view)),
    };
    loadDatasets([ds], "portal | " + target.accession);
  } catch (e: any) {
    error.value = String(e);
  } finally {
    // selectDataset owns `busy` once the user has moved to another dataset.
    if (selected.value === target) busy.value = false;
    downloading.value = false;
  }
}

/** Open the selected views lazily: nothing is downloaded up front, each query
 * fetches only the byte ranges it needs from the portal's storage. */
function streamSelection() {
  if (!selected.value) return;
  const sel = views.value.filter((v) => checked.value[v.path]);
  const ds: DatasetInfo = {
    prefix: selected.value.accession,
    path: `quantms portal / ${portalRef(selected.value)}`,
    views: sel.map((v) => ({ ...v })).sort((a, b) => a.view.localeCompare(b.view)),
  };
  loadDatasets([ds], "portal | " + selected.value.accession + " (stream)");
}

function toggleAll() {
  const allOn = views.value.every((v) => checked.value[v.path]);
  for (const v of views.value) checked.value[v.path] = !allOn;
}

onMounted(loadRegistry);
</script>

<template>
  <div class="portal">
    <h3>Quantms portal — dataset registry</h3>
    <p class="muted">
      Browse, search, and open reanalysed datasets published on the
      <a href="https://portal.quantms.org" target="_blank" rel="noopener">quantms portal</a>.
      Sources load over HTTPS (no AWS credentials needed). <b>Stream</b> the views you choose
      to query them in place (only the byte ranges each query needs are fetched), or
      <b>download them to cache</b> once for fully offline use.
    </p>

    <div v-if="error && !selected" class="error">{{ error }}</div>
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
        <div class="sortbar">
          <span class="muted">Sort</span>
          <button
            v-for="s in SORTS"
            :key="s.key"
            class="chip"
            :class="{ on: sortKey === s.key }"
            @click="setSort(s.key)"
            :title="sortKey === s.key ? 'Click to reverse' : `Sort by ${s.label.toLowerCase()}`"
          >
            {{ s.label }}<span v-if="sortKey === s.key"> {{ sortDesc ? "↓" : "↑" }}</span>
          </button>
        </div>
        <div class="meta muted">
          {{ filtered.length }} of {{ rows.length }} datasets · {{ selected?.accession ?? "none" }} selected
        </div>
        <div class="rows">
          <button
            v-for="r in filtered"
            :key="portalRef(r)"
            class="row"
            :class="{ active: selected && portalRef(selected) === portalRef(r) }"
            @click="selectDataset(r)"
          >
            <div class="row-top">
              <span class="mono acc">{{ r.accession }}</span>
              <span class="muted size" v-if="r.totalSize">{{ fmtSize(r.totalSize) }}</span>
            </div>
            <div class="title">{{ r.title || "—" }}</div>
            <div class="muted sub" v-if="r.organism || r.instrument">
              <span v-if="r.organism">{{ r.organism }}</span>
              <template v-if="r.organism && r.instrument"> · </template>
              <span v-if="r.instrument">{{ r.instrument }}</span>
              <template v-if="r.samples"> · {{ r.samples }} samples</template>
            </div>
            <div class="counts">
              <span :class="{ hi: sortKey === 'peptides' }" title="Distinct peptides">{{ fmtCount(r.peptides) }} pep</span>
              <span :class="{ hi: sortKey === 'psmCount' }" title="PSMs">{{ fmtCount(r.psmCount) }} PSM</span>
              <span :class="{ hi: sortKey === 'proteins' }" title="Proteins">{{ fmtCount(r.proteins) }} prot</span>
              <span v-if="r.collectionTitle" class="coll" :title="r.collectionTitle">{{ r.collectionTitle }}</span>
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
            </div>
            <div class="stats">
              <div><b>{{ fmtSize(selected.totalSize) }}</b><span class="muted">size</span></div>
              <div><b>{{ selected.peptides?.toLocaleString() ?? "—" }}</b><span class="muted">peptides</span></div>
              <div><b>{{ selected.psmCount?.toLocaleString() ?? "—" }}</b><span class="muted">PSMs</span></div>
              <div><b>{{ selected.proteins?.toLocaleString() ?? "—" }}</b><span class="muted">proteins</span></div>
              <div><b>{{ selected.samples?.toLocaleString() ?? "—" }}</b><span class="muted">samples</span></div>
            </div>
          </div>

          <div v-if="views.length" class="toolbar">
            <span class="muted">{{ views.length }} view(s) · {{ selectedCount }} selected<template v-if="selectedCount"> · {{ fmtSize(selectedBytes) }}</template></span>
            <div class="actions">
              <button
                @click="streamSelection"
                :disabled="busy || !selectedCount"
                title="Query the files in place — each query fetches only the byte ranges it needs"
              >
                ⚡ Stream (lazy, no download)
              </button>
              <button class="primary" @click="loadSelection" :disabled="busy || !selectedCount">
                {{ downloading ? "Downloading…" : "Download to cache" }}
              </button>
            </div>
          </div>

          <div v-if="error" class="error">{{ error }}</div>

          <DownloadProgress
            v-if="downloadId"
            class="download"
            :files="downloadFiles"
            :cancelling="cancelling"
            label="Transferring to cache…"
            @cancel="cancel"
          />

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
              <span class="muted">{{ fmtSize(v.sizeBytes, "0 B") }}</span>
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
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 18px;
  margin-top: 16px;
}
.registry {
  display: flex;
  flex-direction: column;
  min-height: 360px;
  height: max(360px, calc(100vh - 430px));
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
.sortbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
}
.chip {
  padding: 2px 9px;
  font-size: 11px;
  border-radius: 999px;
}
.chip.on {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.counts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.counts .hi {
  color: var(--accent);
  font-weight: 600;
}
.counts .coll {
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 45%;
}
.stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.stats div {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.stats span {
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
  min-height: 360px;
  height: max(360px, calc(100vh - 430px));
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
.actions {
  display: flex;
  gap: 8px;
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
.download {
  margin: 10px 0;
}
</style>
