<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api, type DatasetInfo, type S3Listing, type ViewInfo } from "../lib/api";
import { loadDatasets } from "../store";
import { installProgress, overall, progress } from "../lib/progress";
import { cancelDownload, confirmDownload, totalBytes, trackDownload, untrackDownload } from "../lib/downloads";

const bucket = ref("");
const prefix = ref("");
const busy = ref(false);
const error = ref("");
const listing = ref<S3Listing | null>(null);
const checked = ref<Record<string, boolean>>({});
const downloadId = ref("");
const cancelling = ref(false);

const remoteDatasets = computed<DatasetInfo[]>(() => listing.value?.datasets ?? []);

const selectedCount = computed(() => selection().length);
const selectedBytes = computed(() => totalBytes(selection().map((s) => s.view)));

function generateId(): string {
  return (crypto?.randomUUID?.() ?? `d${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
function isCancelledErr(e: unknown): boolean {
  return /cancell?/i.test(String(e));
}
function clearProgressFor(files: string[]) {
  for (const f of files) delete progress[f];
}

async function cancel() {
  if (!downloadId.value) return;
  cancelling.value = true;
  await cancelDownload(downloadId.value);
}

// Leaving the picker ("New source", switching source) cancels its download,
// and a download that still finishes must not load into the new source.
let unmounted = false;
onBeforeUnmount(() => {
  unmounted = true;
  void cancelDownload(downloadId.value);
});

onMounted(installProgress);

async function list() {
  busy.value = true;
  error.value = "";
  listing.value = null;
  checked.value = {};
  try {
    listing.value = await api.listS3(bucket.value.trim() || "qpx-test", prefix.value.trim() || undefined);
    if (!listing.value.datasets.length) {
      error.value = "No QPX datasets (prefix.view.parquet) found under this prefix.";
    }
  } catch (e: any) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

/** [{prefix, view}] for the checked views, preserving dataset grouping. */
function selection(): { prefix: string; view: ViewInfo }[] {
  const out: { prefix: string; view: ViewInfo }[] = [];
  for (const ds of remoteDatasets.value) {
    for (const v of ds.views) {
      if (checked.value[v.path]) out.push({ prefix: ds.prefix, view: v });
    }
  }
  return out;
}

function groupLocal(entries: { prefix: string; local: ViewInfo }[]): DatasetInfo[] {
  const map = new Map<string, ViewInfo[]>();
  for (const e of entries) {
    if (!map.has(e.prefix)) map.set(e.prefix, []);
    map.get(e.prefix)!.push(e.local);
  }
  return [...map.entries()].map(([prefix, views]) => ({
    prefix,
    path: `${listing.value!.bucket}/${prefix}`,
    views: views.sort((a, b) => a.view.localeCompare(b.view)),
    sourceKind: "s3",
  }));
}

/**
 * Build DatasetInfo for the selected views *without* downloading: each view
 * keeps its `s3://bucket/key` path, so the engine presigns a URL and DuckDB
 * streams only the byte ranges each query needs.
 */
function groupStream(): DatasetInfo[] {
  const map = new Map<string, ViewInfo[]>();
  for (const s of selection()) {
    if (!map.has(s.prefix)) map.set(s.prefix, []);
    map.get(s.prefix)!.push(s.view); // s.view.path is already s3://bucket/key
  }
  return [...map.entries()].map(([prefix, views]) => ({
    prefix,
    path: `${listing.value!.bucket}/${prefix}`,
    views: views.sort((a, b) => a.view.localeCompare(b.view)),
    sourceKind: "s3",
  }));
}

async function loadSelection() {
  busy.value = true;
  error.value = "";
  try {
    const sel = selection();
    if (!sel.length) throw new Error("Select at least one view to load.");
    if (!(await confirmDownload(sel.map((s) => s.view), "s3"))) return;
    // The user may have left this source while the dialog was open.
    if (unmounted) return;

    // Download to cache (offline) with progress bars.
    const paths = sel.map((s) => s.view.path);
    const files = sel.map((s) => s.view.name);
    cancelling.value = false;
    const id = generateId();
    downloadId.value = id;
    trackDownload(id);
    try {
      const locals = await api.cacheS3Views(listing.value!.bucket, paths, id);
      if (unmounted) return;
      const entries = sel.map((s, i) => ({ prefix: s.prefix, local: locals[i] }));
      loadDatasets(groupLocal(entries), "s3");
    } catch (e: any) {
      if (isCancelledErr(e)) {
        error.value = "Download cancelled; partial files were removed.";
        clearProgressFor(files);
      } else {
        clearProgressFor(files);
        throw e;
      }
    } finally {
      untrackDownload(id);
      if (downloadId.value === id) downloadId.value = "";
      cancelling.value = false;
    }
  } catch (e: any) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

/** Load the selected views as streaming (lazy) datasets — no download. */
async function streamSelection() {
  busy.value = true;
  error.value = "";
  try {
    if (!selection().length) throw new Error("Select at least one view to stream.");
    loadDatasets(groupStream(), "s3");
  } catch (e: any) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

function toggle(ds: DatasetInfo) {
  const allOn = ds.views.every((v) => checked.value[v.path]);
  for (const v of ds.views) checked.value[v.path] = !allOn;
}

function fmt(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function pct(n: number): string {
  return `${Math.max(0, Math.min(100, n)).toFixed(0)}%`;
}

const activeBars = computed(() =>
  Object.entries(progress)
    .filter(([, b]) => b.phase === "downloading")
    .map(([name, b]) => ({ name, ...b }))
);
const overallPct = computed(() => overall());

const streamHint =
  "Opens the parquet in place on S3 — each query fetches only the byte ranges it needs " +
  "(footer + touched columns/row groups), so even multi-GB files open instantly.";
</script>

<template>
  <div class="s3">
    <h3>S3 source</h3>
    <p class="muted">
      Uses your default AWS credential chain (env vars, <span class="mono">~/.aws/credentials</span>, or an
      IAM role). Pick the parquet views you want, then either <b>download them to cache</b>
      (once, for fully offline querying) or <b>stream them</b> (query the files in place on
      S3 — only the byte ranges each query needs are fetched, nothing is downloaded up front).
    </p>

    <div class="row">
      <input v-model="bucket" placeholder="bucket (e.g. qpx-test)" @keyup.enter="list" />
      <input v-model="prefix" placeholder="prefix (optional)" @keyup.enter="list" />
      <button class="primary" @click="list" :disabled="busy">
        {{ busy ? "Listing…" : "List" }}
      </button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <template v-if="listing">
      <div class="toolbar">
        <span class="muted">{{ remoteDatasets.length }} dataset(s) found<template v-if="selectedCount"> · {{ selectedCount }} selected · {{ fmt(selectedBytes) }}</template></span>
        <div class="actions">
          <button @click="streamSelection" :disabled="busy || !selectedCount" :title="streamHint">
            ⚡ Stream (lazy, no download)
          </button>
          <button class="primary" @click="loadSelection" :disabled="busy || !selectedCount">
            {{ busy ? "Loading…" : "Download to cache" }}
          </button>
        </div>
      </div>
      <div v-if="selectedCount" class="mode-hint muted">{{ streamHint }}</div>

      <!-- progress bars for downloads -->
      <div v-if="downloadId" class="progress-box">
        <div class="overall">
          <span class="muted">{{ cancelling ? "Cancelling…" : activeBars.length ? "Downloading…" : "Checking sizes and disk space…" }}</span>
          <span class="right">
            <span class="muted">{{ overallPct !== null ? pct(overallPct) : "" }}</span>
            <button class="cancel" @click="cancel" :disabled="!downloadId || cancelling">Cancel download</button>
          </span>
        </div>
        <div class="bar"><div class="fill" :style="{ width: pct(overallPct ?? 0) }"></div></div>
        <div v-for="b in activeBars" :key="b.file" class="file-bar">
          <div class="file-row">
            <span class="mono file-name">{{ b.file }}</span>
            <span class="muted">{{ fmt(b.done) }} / {{ b.total ? fmt(b.total) : "…" }} · {{ pct(b.percent) }}</span>
          </div>
          <div class="bar"><div class="fill" :style="{ width: pct(b.percent) }"></div></div>
        </div>
      </div>

      <div v-if="!remoteDatasets.length" class="empty">
        No QPX datasets (named <span class="mono">prefix.view.parquet</span>) were found under this
        bucket/prefix — nothing to select. Try a different bucket or prefix.
      </div>

      <div class="dataset-list">
        <div v-for="ds in remoteDatasets" :key="ds.prefix" class="ds">
          <label class="ds-head">
            <input type="checkbox" :checked="ds.views.every((v) => checked[v.path])" @change="toggle(ds)" />
            <span class="ds-name">{{ ds.prefix }}</span>
            <span class="muted">{{ ds.views.length }} views</span>
          </label>
          <div class="views">
            <label v-for="v in ds.views" :key="v.path" class="view">
              <input v-model="checked[v.path]" type="checkbox" />
              <span class="mono view-name">{{ v.name }}</span>
              <span class="muted">{{ fmt(v.sizeBytes) }}</span>
            </label>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.s3 {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  background: var(--bg-panel);
}
h3 {
  margin: 0 0 6px;
}
.row {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.row input {
  flex: 1;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 18px 0 8px;
  gap: 10px;
  flex-wrap: wrap;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mode-hint {
  font-size: 11px;
  margin: -2px 0 10px;
}
.modes {
  display: flex;
  align-items: center;
  gap: 14px;
}
.mode {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 4px 10px;
}
.mode.on {
  color: var(--text);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.progress-box {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
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
.ds {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 10px;
  padding: 10px 12px;
  background: var(--bg-soft);
}
.ds-head {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.ds-name {
  font-weight: 700;
}
.views {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.view {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 26px;
  font-size: 12px;
}
.view-name {
  flex: 1;
}
</style>
