<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import ChartCard from "../ChartCard.vue";
import ReportTable from "../ReportTable.vue";
import type { DatasetInfo } from "../../lib/api";
import type { ChartSpec } from "../../lib/charts";
import { evidence, type Column, type DatasetTables } from "../../lib/report";
import { PTM_COLUMNS, modificationCounts, modificationSites, modificationsPerPeptide, targetCount } from "../../lib/queries/ptms";
import { ptmColor, shortCode } from "../../lib/ptm";
import { searchFor } from "../../store";
import { useLargeGate } from "../../lib/useLargeGate";
import LargeGate from "./LargeGate.vue";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string }>();
const ev = evidence(props.t);
const evName = props.t.feature ? "features" : "PSMs";
const { gate, check, release, dispose } = useLargeGate();
onUnmounted(dispose);

const busy = ref(true);
const error = ref("");
const mods = ref<Record<string, any>[]>([]);
const sites = ref<Record<string, any>[]>([]);
const modsPerPep = ref<ChartSpec | null>(null);
const metric = ref<"n_pf" | "n_pep" | "n_ev">("n_pf");
const table = ref<InstanceType<typeof ReportTable> | null>(null);

const metricName = computed(() => ({ n_pf: "peptidoforms", n_pep: "peptides", n_ev: evName })[metric.value]);

const landscape = computed<ChartSpec | null>(() => {
  if (busy.value) return null;
  const rows = [...mods.value].sort((a, b) => b[metric.value] - a[metric.value]).slice(0, 30);
  return {
    kind: "hbar",
    labels: rows.map((r) => String(r.name)),
    series: [{ name: metricName.value, values: rows.map((r) => r[metric.value]) }],
    colors: rows.map((r) => ptmColor(r.name, r.accession ?? undefined)),
    xName: `distinct ${metricName.value}`,
    notes: rows.map((r) => siteNote(r.name)),
  };
});

const siteSpec = computed<ChartSpec | null>(() => {
  if (busy.value) return null;
  const names = [...mods.value].sort((a, b) => b.n_ev - a.n_ev).slice(0, 8).map((m) => String(m.name));
  const residues = [...new Set(sites.value.filter((s) => names.includes(s.name)).map((s) => String(s.aa)))].sort();
  const series = names.map((n) => ({
    name: n,
    color: ptmColor(n),
    values: residues.map((aa) => {
      const row = sites.value.find((s) => s.name === n && String(s.aa) === aa);
      return row ? Number(row.n) : 0;
    }),
  }));
  return { kind: "bar", labels: residues, series, stacked: true, xName: "residue / terminus", yName: "sites" };
});

function siteNote(name: string): string {
  const s = sites.value.filter((x) => x.name === name).sort((a, b) => b.n - a.n).slice(0, 6);
  return s.length ? "sites: " + s.map((x) => `${x.aa} ${Number(x.n).toLocaleString()}`).join(", ") : "";
}

const cols: Column[] = [
  { key: "name", label: "Modification" },
  { key: "accession", label: "Accession" },
  { key: "residues", label: "Top residues" },
  { key: "n_pf", label: "Peptidoforms", num: true },
  { key: "n_pep", label: "Peptides", num: true },
  { key: "n_ev", label: evName === "features" ? "Features" : "PSMs", num: true },
  { key: "pct", label: `% of ${evName}`, num: true, fmt: (v) => (v == null ? "" : `${Number(v).toFixed(2)}%`) },
];

const tableRows = computed(() =>
  mods.value.map((m): Record<string, any> => ({
    ...m,
    residues: sites.value
      .filter((s) => s.name === m.name)
      .sort((a, b) => b.n - a.n)
      .slice(0, 4)
      .map((s) => s.aa)
      .join(" "),
  }))
);

onMounted(() => {
  if (!ev || !ev.cols.has("modifications")) {
    busy.value = false;
    return;
  }
  check([{ ref: ev, cols: PTM_COLUMNS }], build);
});

async function build() {
  if (!ev) return;
  busy.value = true;
  try {
    const n = (await targetCount(props.ds, ev)) || 1;
    mods.value = (await modificationCounts(props.ds, ev)).map((m) => ({ ...m, pct: (100 * m.n_ev) / n }));
    sites.value = await modificationSites(props.ds, ev);
    modsPerPep.value = await modificationsPerPeptide(props.ds, ev, evName);
  } catch (e: any) {
    error.value = String(e?.message ?? e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div v-if="!ev || !ev.cols.has('modifications')" class="muted pad">No `modifications` column in this dataset's feature/PSM view.</div>
    <div v-else-if="error" class="error pad">⚠ {{ error }}</div>
    <LargeGate v-else-if="gate.blocked" :bytes="gate.bytes" :size="gate.size" what="Counting modifications" @go="release" />
    <div v-else-if="gate.error" class="error pad">⚠ {{ gate.error }}</div>
    <div v-else-if="gate.checking" class="muted pad"><span class="spinner"></span></div>
    <template v-else>
      <p class="muted note">
        <span v-if="busy">Counting modifications… <span class="spinner"></span> · </span>
        Colours follow your PTM colour settings. Click a modification in the table to list its peptidoforms.
      </p>
      <div class="grid">
        <ChartCard title="Modification landscape" :subtitle="`Distinct ${metricName} carrying each modification. Hover for the per-residue split.`" :spec="landscape" :loading="busy" :file-base="fileBase" :height="Math.max(220, Math.min(30, mods.length) * 24 + 40)">
          <template #actions>
            <select v-model="metric" class="mini">
              <option value="n_pf">Peptidoforms</option>
              <option value="n_pep">Peptides</option>
              <option value="n_ev">{{ evName === "features" ? "Features" : "PSMs" }}</option>
            </select>
          </template>
        </ChartCard>
        <ChartCard title="Modified sites by residue" subtitle="Sites for the 8 most frequent modifications." :spec="siteSpec" :loading="busy" :file-base="fileBase" />
        <ChartCard title="Modifications per peptide" :subtitle="`Target ${evName} by number of modifications (incl. fixed).`" :spec="modsPerPep" :loading="busy" :file-base="fileBase" />
      </div>
      <div class="sec">
        <div class="sec-head">
          <h3>Modifications <span class="muted">({{ mods.length }})</span></h3>
          <button class="xs" :disabled="!mods.length" @click="table?.exportCsv()">CSV</button>
        </div>
        <ReportTable
          ref="table"
          :columns="cols"
          :rows="tableRows"
          clickable
          :file-name="`${fileBase}_modifications`"
          @row="(r) => searchFor('peptides', '', String(r.name))"
        >
          <template #cell-name="{ row }">
            <span class="mod" :style="{ '--ptm': ptmColor(row.name, row.accession ?? undefined) }">
              <span class="dot"></span>{{ row.name }}
              <span class="muted code">{{ shortCode(row.name, row.accession ?? undefined) }}</span>
            </span>
          </template>
        </ReportTable>
      </div>
    </template>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 14px;
}
.note {
  font-size: 12px;
  margin: 0 0 12px;
}
.sec {
  margin-top: 18px;
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
h3 {
  margin: 0;
  font-size: 14px;
}
button.xs {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 6px;
}
select.mini {
  padding: 1px 4px;
  font-size: 11px;
  border-radius: 6px;
}
.mod {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ptm);
}
.code {
  font-size: 10px;
}
.pad {
  padding: 18px;
}
</style>
