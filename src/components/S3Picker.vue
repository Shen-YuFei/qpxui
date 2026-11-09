<script setup lang="ts">
import { computed, ref } from "vue";
import { api, type DatasetInfo, type S3Listing, type ViewInfo } from "../lib/api";
import { loadDatasets } from "../store";
import { confirmDownload, totalBytes, useDownload } from "../lib/downloads";
import { fmtBytes } from "../lib/format";
import DownloadProgress from "./DownloadProgress.vue";

const bucket = ref("");
const prefix = ref("");
const busy = ref(false);
const error = ref("");
const listing = ref<S3Listing | null>(null);
const checked = ref<Record<string, boolean>>({});
const { id: downloadId, cancelling, files: downloadFiles, cancel, run: runDownload, unmounted } = useDownload();

const remoteDatasets = computed<DatasetInfo[]>(() => listing.value?.datasets ?? []);

const selectedCount = computed(() => selection().length);
const selectedBytes = computed(() => totalBytes(selection().map((s) => s.view)));

async function list() {
  if (!bucket.value.trim()) return;
  busy.value = true;
  error.value = "";
  listing.value = null;
  checked.value = {};
  try {
    listing.value = await api.listS3(bucket.value.trim(), prefix.value.trim() || undefined);
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

/** One dataset per prefix of the given views. */
function group(entries: { prefix: string; view: ViewInfo }[]): DatasetInfo[] {
  const map = new Map<string, ViewInfo[]>();
  for (const e of entries) {
    if (!map.has(e.prefix)) map.set(e.prefix, []);
    map.get(e.prefix)!.push(e.view);
  }
  return [...map.entries()].map(([prefix, views]) => ({
    prefix,
    path: `${listing.value!.bucket}/${prefix}`,
    views: views.sort((a, b) => a.view.localeCompare(b.view)),
  }));
}

async function loadSelection() {
  busy.value = true;
  error.value = "";
  try {
    const sel = selection();
    if (!(await confirmDownload(sel.map((s) => s.view), "s3"))) return;
    // The user may have left this source while the dialog was open, and a
    // download that still finishes must not load into the new source.
    if (unmounted()) return;
    const paths = sel.map((s) => s.view.path);
    const locals = await runDownload((id) => api.cacheS3Views(listing.value!.bucket, paths, id));
    if (unmounted()) return;
    if (!locals) {
      error.value = "Download cancelled; partial files were removed.";
      return;
    }
    loadDatasets(group(sel.map((s, i) => ({ prefix: s.prefix, view: locals[i] }))), "s3");
  } catch (e: any) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

/** Load the selected views as streaming (lazy) datasets — no download: each
 * keeps its `s3://bucket/key` path, and DuckDB reads only the byte ranges each
 * query needs through the backend range proxy. */
function streamSelection() {
  loadDatasets(group(selection()), "s3");
}

function toggle(ds: DatasetInfo) {
  const allOn = ds.views.every((v) => checked.value[v.path]);
  for (const v of ds.views) checked.value[v.path] = !allOn;
}

const streamHint =
  "Opens the parquet in place on S3 — each query fetches only the byte ranges it needs " +
  "(footer + touched columns/row groups), so even multi-GB files open instantly.";
</script>

<template>
  <div class="s3">
    <h2 class="section-title">S3 source</h2>
    <p class="muted">
      Uses your default AWS credential chain (env vars, <span class="mono">~/.aws/credentials</span>, or an
      IAM role). Pick the parquet views you want, then either <b>download them to cache</b>
      (once, for fully offline querying) or <b>stream them</b> (query the files in place on
      S3 — only the byte ranges each query needs are fetched, nothing is downloaded up front).
    </p>

    <div class="row">
      <input v-model="bucket" placeholder="bucket (e.g. qpx-test)" @keyup.enter="list" />
      <input v-model="prefix" placeholder="prefix (optional)" @keyup.enter="list" />
      <button class="primary" @click="list" :disabled="busy || !bucket.trim()">
        {{ busy ? "Listing…" : "List" }}
      </button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <template v-if="listing">
      <div class="toolbar">
        <span class="muted">{{ remoteDatasets.length }} dataset(s) found<template v-if="selectedCount"> · {{ selectedCount }} selected · {{ fmtBytes(selectedBytes) }}</template></span>
        <div class="actions">
          <button @click="streamSelection" :disabled="busy || !selectedCount" :title="streamHint">
            Stream
          </button>
          <button class="primary" @click="loadSelection" :disabled="busy || !selectedCount">
            {{ busy ? "Loading…" : "Download to cache" }}
          </button>
        </div>
      </div>
      <div v-if="selectedCount" class="mode-hint muted">{{ streamHint }}</div>

      <DownloadProgress
        v-if="downloadId"
        class="download"
        :files="downloadFiles"
        :cancelling="cancelling"
        label="Transferring to cache…"
        @cancel="cancel"
      />

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
              <span class="muted">{{ fmtBytes(v.sizeBytes) }}</span>
            </label>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>

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
  font-size: 13px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mode-hint {
  font-size: 12px;
  margin: -2px 0 10px;
}
.download {
  margin-bottom: 12px;
}
.ds {
  border-bottom: 1px solid var(--rule);
  padding: 9px 8px;
}
.ds:first-of-type {
  border-top: 1px solid var(--border);
}
.ds-head {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.ds-name {
  font-family: var(--mono);
  font-weight: 500;
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
  font-size: 13px;
}
.view-name {
  flex: 1;
}
</style>
