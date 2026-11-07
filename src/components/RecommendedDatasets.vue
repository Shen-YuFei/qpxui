<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type PortalDataset } from "../lib/api";
import PortalViews from "./PortalViews.vue";

const datasets = ref<PortalDataset[]>([]);
const busy = ref(false);
const loadingMsg = ref("Loading recommended datasets…");
const error = ref("");

const selected = ref<PortalDataset | null>(null);

function rowKey(ds: PortalDataset): string {
  return ds.datasetRef ?? ds.accession;
}
function isOpen(ds: PortalDataset): boolean {
  return !!selected.value && rowKey(selected.value) === rowKey(ds);
}
function portalName(ds: PortalDataset): string {
  return ds.datasetRef ?? ds.accession;
}

async function loadRecommended() {
  busy.value = true;
  error.value = "";
  try {
    // Feature the biological collections (e.g. human cancer cell lines) and
    // skip the huge MS-Net reanalysis collection, which otherwise dominates a
    // by-sample-count ranking. Take the most-analyzed datasets per collection.
    const preferred: { name: string; take: number }[] = [
      { name: "celllines", take: 5 },
      { name: "immunopeptidomics", take: 1 },
    ];
    const picked: PortalDataset[] = [];
    const seen = new Set<string>();
    for (const { name, take } of preferred) {
      if (picked.length >= 6) break;
      const res = await api.portalSearch(null, { collection: name, sort: "samples", pageSize: take });
      for (const d of res.datasets) {
        const key = d.datasetRef ?? d.accession;
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push(d);
        if (picked.length >= 6) break;
      }
    }
    datasets.value = picked;
    if (!datasets.value.length) loadingMsg.value = "No featured datasets available.";
  } catch (e: any) {
    error.value = String(e);
    loadingMsg.value = "";
  } finally {
    busy.value = false;
  }
}

function toggleDataset(ds: PortalDataset) {
  selected.value = isOpen(ds) ? null : ds;
}

function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}

onMounted(() => {
  loadRecommended();
});
</script>

<template>
  <section class="recommended">
    <div class="rec-head">
      <h3>✨ Recommended datasets</h3>
      <p class="muted">
        Featured biological datasets from the quantms portal — human cancer cell lines and
        immunopeptidomics. Expand one to pick its QPX views, then <b>Stream</b> lazily or
        <b>download to cache</b>.
      </p>
    </div>

    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="busy && !datasets.length" class="muted">
      {{ loadingMsg }} <span class="spinner"></span>
    </div>

    <div v-if="datasets.length" class="grid">
      <article
        v-for="ds in datasets"
        :key="rowKey(ds)"
        class="card"
        :class="{ open: isOpen(ds) }"
      >
        <header class="card-head" @click="toggleDataset(ds)">
          <div class="acc-row">
            <span class="acc">{{ ds.accession }}</span>
            <span v-if="ds.collectionTitle" class="chip" :title="ds.collectionTitle">{{ ds.collectionTitle }}</span>
            <span class="spacer"></span>
            <span class="chev">{{ isOpen(ds) ? "▾" : "▸" }}</span>
          </div>
          <h4>{{ ds.title || ds.accession }}</h4>
          <div class="sub muted">
            <span v-if="ds.organism">{{ ds.organism }}</span>
            <span v-if="ds.instrument"> · {{ ds.instrument }}</span>
            <span v-if="ds.samples"> · {{ ds.samples }} samples</span>
          </div>
          <div class="counts">
            <span class="stat" title="Proteins"><b>{{ fmtCount(ds.proteins) }}</b> prot</span>
            <span class="stat" title="Distinct peptides"><b>{{ fmtCount(ds.peptides) }}</b> pep</span>
            <span class="stat" title="PSMs"><b>{{ fmtCount(ds.psmCount) }}</b> PSM</span>
          </div>
        </header>

        <PortalViews
          v-if="isOpen(ds)"
          :accession="ds.accession"
          :dataset-ref="portalName(ds)"
          :organism="ds.organism"
          :psm-count="ds.psmCount"
          all-when-none
        />
      </article>
    </div>
  </section>
</template>

<style scoped>
.recommended {
  margin-top: 28px;
  padding-top: 22px;
  border-top: 1px solid var(--border);
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.rec-head h3 {
  margin: 0 0 4px;
}
.rec-head p {
  margin: 0 0 12px;
  font-size: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: minmax(170px, 1fr);
  gap: 12px;
  flex: 1 1 auto;
}
@media (max-width: 1200px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
}
.card.open {
  border-color: var(--accent);
}
.card-head {
  cursor: pointer;
}
.acc-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.acc {
  font-weight: 700;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 12px;
}
.chip {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--muted);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.chev {
  color: var(--muted);
}
.card h4 {
  margin: 6px 0 2px;
  font-size: 13px;
}
.sub {
  font-size: 11px;
}
.counts {
  display: flex;
  gap: 14px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}
.counts b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.error {
  margin: 8px 0;
  color: var(--err);
  font-size: 12px;
}
</style>
