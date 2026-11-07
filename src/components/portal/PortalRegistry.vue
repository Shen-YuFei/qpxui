<script setup lang="ts">
// The portal picker's searchable, sortable list of registry datasets.
import { computed, ref } from "vue";
import { portalRef, type PortalDataset } from "../../lib/api";
import { fmtCount, fmtSize } from "../../lib/format";
import { REGISTRY_SORTS as SORTS, filterRegistry, nextSort, type RegistrySort } from "../../lib/registry";

const props = defineProps<{ rows: PortalDataset[]; selected: PortalDataset | null }>();
const emit = defineEmits<{ (e: "select", ds: PortalDataset): void }>();

const query = ref("");
const sortKey = ref<RegistrySort>("accession");
const sortDesc = ref(false);

function setSort(k: RegistrySort) {
  const s = nextSort({ key: sortKey.value, desc: sortDesc.value }, k);
  sortKey.value = s.key;
  sortDesc.value = s.desc;
}

const filtered = computed(() => filterRegistry(props.rows, query.value, sortKey.value, sortDesc.value));
</script>

<template>
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
        @click="emit('select', r)"
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
</template>

<style scoped>
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
.empty {
  padding: 12px;
  font-size: 12px;
}
</style>
