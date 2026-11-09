<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ChartCard from "../ChartCard.vue";
import PeptideSeq from "../PeptideSeq.vue";
import ReportTable from "../ReportTable.vue";
import type { Column } from "../../lib/report";
import type { DatasetInfo } from "../../lib/api";
import type { ChartSpec } from "../../lib/charts";
import { evidence, proteinExpr, viewScale, type DatasetTables, type ViewScale } from "../../lib/report";
import {
  PROTEIN_LIMIT as LIMIT,
  proteinGroupNames,
  proteinGroupRuns,
  proteinPeptidoforms,
  proteinRunsChart,
  searchProteins,
} from "../../lib/queries/proteins";
import { fmtBytes, listText } from "../../lib/format";
import { searchFor, state } from "../../store";
import { COL } from "../../lib/qpx";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string }>();

const ev = evidence(props.t);
const pg = props.t.pg;
const prot = ev ? proteinExpr(ev) : null;
const evName = props.t.feature ? "features" : "PSMs";

const q = ref(state.search.proteins);
const busy = ref(false);
const error = ref("");
const rows = ref<Record<string, any>[]>([]);
const truncated = ref(false);
const elapsed = ref(0);
const listTable = ref<InstanceType<typeof ReportTable> | null>(null);
// Big streamed files: no top-protein listing until the user searches.
const scale = ref<ViewScale | null>(null);
const waiting = ref(false);

const listCols = computed<Column[]>(() => {
  const base: Column[] = [
    { key: "protein", label: "Protein" },
    { key: "names", label: "Names" },
    { key: "genes", label: "Genes" },
    { key: "runs", label: "Runs", num: true },
    { key: "peptides", label: "Peptides", num: true },
  ];
  if (pg) {
    base.push({ key: "unique_peptides", label: "Unique pep.", num: true });
    base.push({ key: "qvalue", label: "Best q-value", num: true, fmt: (v) => (v == null ? "" : Number(v).toExponential(1)) });
    base.push({ key: "coverage", label: "Coverage %", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(1)) });
  } else {
    base.push({ key: "n_ev", label: evName === "features" ? "Features" : "PSMs", num: true });
  }
  base.push({ key: "log_int", label: "Mean log10 int.", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(2)) });
  return base.filter((c) => rows.value.length === 0 || c.key in rows.value[0]);
});

async function search() {
  if (!pg && !(ev && prot)) return;
  waiting.value = false;
  busy.value = true;
  error.value = "";
  const t0 = performance.now();
  try {
    const r = await searchProteins(pg, ev, prot, q.value);
    truncated.value = r.truncated;
    rows.value = r.rows;
    elapsed.value = performance.now() - t0;
    if (rows.value.length === 1 && q.value.trim()) select(rows.value[0].protein);
  } catch (e: any) {
    error.value = String(e?.message ?? e);
  } finally {
    busy.value = false;
  }
}

// ---- detail pane ----
const focus = ref<string | null>(state.proteinFocus);
const detail = ref<Record<string, any> | null>(null);
const peptides = ref<Record<string, any>[]>([]);
const perRun = ref<ChartSpec | null>(null);
const pgRuns = ref<Record<string, any>[]>([]);
const dBusy = ref(false);
const dError = ref("");
const pepTable = ref<InstanceType<typeof ReportTable> | null>(null);

const pepCols = computed<Column[]>(() =>
  [
    { key: "peptidoform", label: "Peptidoform" },
    { key: "charges", label: "Charges", fmt: (v: any) => listText(v, 6) },
    { key: "n_ev", label: evName === "features" ? "Features" : "PSMs", num: true },
    { key: "runs", label: "Runs", num: true },
    { key: "best_pep", label: "Best PEP", num: true, fmt: (v: any) => (v == null ? "" : Number(v).toExponential(1)) },
    { key: "log_int", label: "Mean log10 int.", num: true, fmt: (v: any) => (v == null ? "" : Number(v).toFixed(2)) },
    { key: "unique", label: "Unique" },
  ].filter((c) => peptides.value.length === 0 || c.key in peptides.value[0])
);
const pgRunCols: Column[] = [
  { key: "run_file_name", label: "Run" },
  { key: "peptides", label: "Peptides", num: true },
  { key: "unique_peptides", label: "Unique", num: true },
  { key: "features", label: "Features", num: true },
  { key: "qvalue", label: "q-value", num: true, fmt: (v) => (v == null ? "" : Number(v).toExponential(1)) },
  { key: "log_int", label: "log10 int.", num: true, fmt: (v) => (v == null ? "" : Number(v).toFixed(2)) },
];

function select(acc: string) {
  focus.value = acc;
  state.proteinFocus = acc;
}

async function loadDetail(acc: string) {
  dBusy.value = true;
  dError.value = "";
  detail.value = rows.value.find((r) => r.protein === acc) ?? { protein: acc };
  peptides.value = [];
  perRun.value = null;
  pgRuns.value = [];
  try {
    if (ev) {
      peptides.value = await proteinPeptidoforms(ev, acc);
      perRun.value = await proteinRunsChart(ev, acc, evName);
    }
    if (pg && pg.cols.has(COL.run_file_name)) {
      pgRuns.value = await proteinGroupRuns(pg, acc);
      if (!detail.value?.names && pgRuns.value.length) {
        detail.value = { ...detail.value, ...(await proteinGroupNames(pg, acc)) };
      }
    }
  } catch (e: any) {
    dError.value = String(e?.message ?? e);
  } finally {
    dBusy.value = false;
  }
}

watch(focus, (acc) => acc && loadDetail(acc));
watch(
  () => state.search.nonce,
  () => {
    q.value = state.search.proteins;
    focus.value = state.proteinFocus;
    search();
  }
);
watch(
  () => state.proteinFocus,
  (acc) => {
    if (acc && acc !== focus.value) focus.value = acc;
  }
);

onMounted(async () => {
  if (focus.value) loadDetail(focus.value);
  const src = pg ?? ev;
  if (src && !q.value.trim()) {
    try {
      scale.value = await viewScale(src);
    } catch (e: any) {
      // Without the footer the file's size is unknown: don't scan it blindly.
      error.value = String(e?.message ?? e);
      return;
    }
    if (scale.value?.large) {
      waiting.value = true;
      return;
    }
  }
  search();
});

const accessionLinks = computed(() => {
  const accs: string[] = Array.isArray(detail.value?.accessions)
    ? detail.value!.accessions.map((a: any) => (typeof a === "object" && a ? a.accession : a))
    : [detail.value?.protein].filter(Boolean);
  return accs.slice(0, 12).map((a) => {
    const m = /^(?:sp|tr)\|([^|]+)\|/.exec(a);
    const id = m ? m[1] : a;
    return { label: a, href: /^[A-Z0-9]{6,10}(-\d+)?$/.test(id) ? `https://www.uniprot.org/uniprotkb/${id}` : null };
  });
});
</script>

<template>
  <div v-if="!pg && !(ev && prot)" class="muted pad">No protein-group or protein-annotated evidence view in this dataset.</div>
  <div v-else class="split" :class="{ open: !!focus }">
    <div class="left">
      <form class="bar" @submit.prevent="search">
        <input v-model="q" class="search" placeholder="Search accession, protein or gene name (e.g. P04637, ALBU, TP53)…" />
        <button class="primary" type="submit" :disabled="busy">Search</button>
        <button class="xs" type="button" :disabled="!rows.length" @click="listTable?.exportCsv()">CSV</button>
      </form>
      <div class="muted info">
        <span v-if="busy">Searching… <span class="spinner"></span></span>
        <span v-else-if="waiting">
          Large streamed {{ pg ? "protein-group" : evName }} view ({{ fmtBytes(scale!.bytes) }}, {{ scale!.rows.toLocaleString() }} rows): enter an accession or gene name to search.
          Press Search with an empty box to list the top {{ LIMIT }} (reads the protein columns of the whole file).
        </span>
        <span v-else>
          {{ rows.length.toLocaleString() }}{{ truncated ? "+" : "" }} {{ pg ? "protein group" : "protein" }}{{ rows.length === 1 ? "" : "s" }}
          <template v-if="truncated"> (first {{ LIMIT }} shown — refine the search)</template>
          · {{ (elapsed / 1000).toFixed(2) }} s · from {{ pg ? "protein groups (pg)" : evName }} · click a protein for its peptidoforms and per-run evidence
        </span>
      </div>
      <div v-if="error" class="error">{{ error }}</div>
      <ReportTable
        v-else
        ref="listTable"
        :columns="listCols"
        :rows="rows"
        row-key="protein"
        :selected="focus"
        clickable
        max-height="calc(100vh - 290px)"
        :file-name="`${fileBase}_proteins${q ? '_' + q : ''}`"
        @row="(r) => select(r.protein)"
      >
        <template #cell-protein="{ value }"><span class="mono acc">{{ value }}</span></template>
        <template #cell-genes="{ value }"><b>{{ listText(value) }}</b></template>
      </ReportTable>
    </div>

    <div v-if="focus" class="right">
      <div class="dhead">
        <div>
          <div class="dtitle mono">{{ focus }}</div>
          <div class="muted dsub">
            <template v-if="detail?.genes"><b>{{ listText(detail.genes, 6) }}</b> · </template>
            <template v-if="detail?.names">{{ listText(detail.names, 4) }}</template>
          </div>
          <div class="links">
            <template v-for="a in accessionLinks" :key="a.label">
              <a v-if="a.href" :href="a.href" target="_blank" rel="noreferrer" class="mono">{{ a.label }} ↗</a>
              <span v-else class="mono muted">{{ a.label }}</span>
            </template>
          </div>
        </div>
        <button class="xs" title="Close" @click="focus = null; state.proteinFocus = null">✕</button>
      </div>
      <div v-if="dError" class="error">{{ dError }}</div>
      <div v-else-if="dBusy" class="muted"><span class="spinner"></span> Loading evidence…</div>
      <template v-else>
        <div class="kpis">
          <div><b>{{ peptides.length.toLocaleString() }}</b><span>peptidoforms</span></div>
          <div><b>{{ new Set(peptides.map((p) => p.sequence)).size.toLocaleString() }}</b><span>peptides</span></div>
          <div><b>{{ peptides.reduce((a, p) => a + Number(p.n_ev || 0), 0).toLocaleString() }}</b><span>{{ evName }}</span></div>
          <div v-if="pgRuns.length"><b>{{ pgRuns.length.toLocaleString() }}</b><span>runs (pg)</span></div>
        </div>
        <ChartCard v-if="perRun" title="Per-run evidence" :subtitle="`${evName} and peptides of this protein in each run.`" :spec="perRun" :file-base="`${fileBase}_${focus}`" :height="200" />
        <div class="sec">
          <div class="sec-head">
            <h3>Peptidoforms</h3>
            <button class="xs" :disabled="!peptides.length" @click="pepTable?.exportCsv()">CSV</button>
          </div>
          <ReportTable ref="pepTable" :columns="pepCols" :rows="peptides" clickable max-height="360px" :file-name="`${fileBase}_${focus}_peptidoforms`" @row="(r) => searchFor('peptides', String(r.sequence ?? r.peptidoform))">
            <template #cell-peptidoform="{ row }">
              <PeptideSeq :peptidoform="row.peptidoform" :sequence="row.sequence" :modifications="row.modifications" />
            </template>
          </ReportTable>
        </div>
        <div v-if="pgRuns.length" class="sec">
          <div class="sec-head"><h3>Protein group per run</h3></div>
          <ReportTable :columns="pgRunCols.filter((c) => c.key in pgRuns[0])" :rows="pgRuns" max-height="300px" :file-name="`${fileBase}_${focus}_runs`" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
.split.open {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.left,
.right {
  min-width: 0;
}
.bar {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.search {
  flex: 1;
}
.info {
  font-size: 12px;
  margin-bottom: 8px;
}
.acc {
  color: var(--accent);
}
.right {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-panel);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-self: start;
}
.dhead {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.dtitle {
  font-family: var(--mono);
  font-weight: 500;
  font-size: 15px;
  word-break: break-all;
}
.dsub {
  font-size: 12px;
  margin-top: 2px;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
  margin-top: 4px;
}
.links a {
  color: var(--accent);
  text-decoration: none;
}
/* A stat strip: value over a sentence-case label, hairlines between. */
.kpis {
  display: flex;
  flex-wrap: wrap;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  padding: 8px 0;
}
.kpis div {
  display: flex;
  flex-direction: column;
  padding: 0 18px;
  border-left: 1px solid var(--rule);
}
.kpis div:first-child {
  padding-left: 0;
  border-left: none;
}
.kpis b {
  font-size: 18px;
  font-weight: 600;
}
.kpis span {
  font-size: 12px;
  color: var(--muted);
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
h3 {
  margin: 0;
  font-size: 15px;
}
.pad {
  padding: 18px;
}
</style>
