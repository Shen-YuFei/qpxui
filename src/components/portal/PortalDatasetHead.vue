<script setup lang="ts">
// The portal picker's heading for the selected dataset: accession, title,
// organism and instrument, and its size and counts.
import type { PortalDataset } from "../../lib/api";
import { fmtSize } from "../../lib/format";

defineProps<{ ds: PortalDataset }>();
</script>

<template>
  <div class="detail-head">
    <div class="mono acc">{{ ds.accession }}</div>
    <div class="title">{{ ds.title || ds.accession }}</div>
    <div class="muted" v-if="ds.organism || ds.instrument || ds.samples">
      <span v-if="ds.organism">{{ ds.organism }}</span>
      <span v-if="ds.instrument"> · {{ ds.instrument }}</span>
      <span v-if="ds.samples"> · {{ ds.samples }} samples</span>
    </div>
    <div class="stats">
      <div><b>{{ fmtSize(ds.totalSize) }}</b><span class="muted">size</span></div>
      <div><b>{{ ds.peptides?.toLocaleString() ?? "—" }}</b><span class="muted">peptides</span></div>
      <div><b>{{ ds.psmCount?.toLocaleString() ?? "—" }}</b><span class="muted">PSMs</span></div>
      <div><b>{{ ds.proteins?.toLocaleString() ?? "—" }}</b><span class="muted">proteins</span></div>
      <div><b>{{ ds.samples?.toLocaleString() ?? "—" }}</b><span class="muted">samples</span></div>
    </div>
  </div>
</template>

<style scoped>
.acc {
  font-weight: 600;
  color: var(--accent);
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
</style>
