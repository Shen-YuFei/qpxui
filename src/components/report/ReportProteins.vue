<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ChartCard from "../ChartCard.vue";
import PeptideSeq from "../PeptideSeq.vue";
import ReportTable from "../ReportTable.vue";
import type { Column } from "../../lib/report";
import type { DatasetInfo } from "../../lib/api";
import type { ChartSpec } from "../../lib/charts";
import {
  evidence,
  ident,
  intensitySumExpr,
  listText,
  objects,
  proteinExpr,
  proteinMatchWhere,
  proteinTextWhere,
  targetWhere,
  viewScale,
  type DatasetTables,
  type ViewScale,
} from "../../lib/report";
import { fmtBytes } from "../../lib/format";
import { runSql } from "../../lib/duck";
import { searchFor, state } from "../../store";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string }>();

const LIMIT = 500;
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

function pgSql(where: string): string {
  const P = pg!;
  const T = ident(P.table);
  const has = (c: string) => P.cols.has(c);
  const isum = intensitySumExpr(P);
  const sel = [
    "anchor_protein AS protein",
    has("pg_accessions") ? "any_value(pg_accessions) AS accessions" : null,
    has("pg_names") ? "any_value(pg_names) AS names" : null,
    has("gg_names") ? "any_value(gg_names) AS genes" : null,
    has("run_file_name") ? "count(DISTINCT run_file_name)::BIGINT AS runs" : null,
    has("peptide_counts") ? "max(peptide_counts.total_sequences)::BIGINT AS peptides" : null,
    has("peptide_counts") ? "max(peptide_counts.unique_sequences)::BIGINT AS unique_peptides" : null,
    has("global_qvalue") ? "min(global_qvalue) AS qvalue" : has("pg_qvalue") ? "min(pg_qvalue) AS qvalue" : null,
    has("sequence_coverage") ? "max(sequence_coverage) AS coverage" : null,
    isum ? `avg(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS log_int` : null,
  ].filter(Boolean);
  return `SELECT ${sel.join(", ")} FROM ${T}
WHERE ${targetWhere(P)} AND anchor_protein IS NOT NULL AND ${where}
GROUP BY anchor_protein ORDER BY ${has("run_file_name") ? "runs DESC, " : ""}${has("peptide_counts") ? "peptides DESC, " : ""}protein
LIMIT ${LIMIT + 1}`;
}

function evSql(where: string): string {
  const E = ev!;
  const T = ident(E.table);
  const isum = intensitySumExpr(E);
  const sel = [
    `${prot} AS protein`,
    E.cols.has("gg_names") ? "any_value(gg_names) AS genes" : null,
    E.cols.has("run_file_name") ? "count(DISTINCT run_file_name)::BIGINT AS runs" : null,
    E.seq !== "NULL" ? `count(DISTINCT ${E.seq})::BIGINT AS peptides` : null,
    "count(*)::BIGINT AS n_ev",
    isum ? `avg(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS log_int` : null,
  ].filter(Boolean);
  return `SELECT ${sel.join(", ")} FROM ${T}
WHERE ${targetWhere(E)} AND ${prot} IS NOT NULL AND ${where}
GROUP BY 1 ORDER BY ${E.seq !== "NULL" ? "peptides DESC, " : ""}n_ev DESC LIMIT ${LIMIT + 1}`;
}

async function search() {
  if (!pg && !(ev && prot)) return;
  waiting.value = false;
  busy.value = true;
  error.value = "";
  const t0 = performance.now();
  try {
    const sql = pg ? pgSql(proteinTextWhere(pg, q.value)) : evSql(proteinTextWhere(ev!, q.value));
    const r = await runSql(sql, LIMIT + 1);
    const out = objects(r);
    truncated.value = out.length > LIMIT;
    rows.value = out.slice(0, LIMIT);
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
      const T = ident(ev.table);
      const W = `${targetWhere(ev)} AND ${proteinMatchWhere(ev, acc)}`;
      const isum = intensitySumExpr(ev);
      const has = (c: string) => ev.cols.has(c);
      const pf = has("peptidoform") ? "peptidoform" : ev.seq;
      const sel = [
        `${pf} AS peptidoform`,
        `any_value(${ev.seq}) AS sequence`,
        has("modifications") ? "any_value(modifications) AS modifications" : null,
        has("charge") ? "list_sort(list_distinct(list(charge))) AS charges" : null,
        "count(*)::BIGINT AS n_ev",
        has("run_file_name") ? "count(DISTINCT run_file_name)::BIGINT AS runs" : null,
        has("posterior_error_probability") ? "min(posterior_error_probability) AS best_pep" : null,
        isum ? `avg(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS log_int` : null,
        has("unique") ? `bool_or("unique") AS "unique"` : null,
      ].filter(Boolean);
      const r = await runSql(`SELECT ${sel.join(", ")} FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY n_ev DESC LIMIT 2000`, 2000);
      peptides.value = objects(r);
      if (has("run_file_name")) {
        const rr = await runSql(
          `SELECT run_file_name, count(*)::BIGINT AS n${ev.seq !== "NULL" ? `, count(DISTINCT ${ev.seq})::BIGINT AS p` : ""}
           ${isum ? `, median(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS li` : ""}
           FROM ${T} WHERE ${W} GROUP BY 1 ORDER BY 1`
        );
        const o = objects(rr).sort((a, b) => String(a.run_file_name).localeCompare(String(b.run_file_name), undefined, { numeric: true }));
        perRun.value = {
          kind: "bar",
          labels: o.map((x) => String(x.run_file_name)),
          series: [
            { name: evName, values: o.map((x) => x.n) },
            ...(ev.seq !== "NULL" ? [{ name: "peptides", values: o.map((x) => x.p) }] : []),
          ],
          notes: isum ? o.map((x) => (x.li == null ? "" : `median log10 intensity ${Number(x.li).toFixed(2)}`)) : undefined,
          xName: "run",
          hideLabels: o.length > 30,
        };
      }
    }
    if (pg && pg.cols.has("run_file_name")) {
      const isum = intensitySumExpr(pg);
      const has = (c: string) => pg.cols.has(c);
      const sel = [
        "run_file_name",
        has("peptide_counts") ? "peptide_counts.total_sequences AS peptides" : null,
        has("peptide_counts") ? "peptide_counts.unique_sequences AS unique_peptides" : null,
        has("feature_counts") ? "feature_counts.total_features AS features" : null,
        has("pg_qvalue") ? "pg_qvalue AS qvalue" : has("global_qvalue") ? "global_qvalue AS qvalue" : null,
        isum ? `CASE WHEN ${isum} > 0 THEN log10(${isum}) END AS log_int` : null,
      ].filter(Boolean);
      const r = await runSql(
        `SELECT ${sel.join(", ")} FROM ${ident(pg.table)} WHERE ${targetWhere(pg)} AND anchor_protein = '${acc.replace(/'/g, "''")}' ORDER BY run_file_name`
      );
      pgRuns.value = objects(r);
      if (!detail.value?.names && pgRuns.value.length) {
        const meta = await runSql(
          `SELECT any_value(pg_accessions) AS accessions${has("pg_names") ? ", any_value(pg_names) AS names" : ""}${has("gg_names") ? ", any_value(gg_names) AS genes" : ""}
           FROM ${ident(pg.table)} WHERE anchor_protein = '${acc.replace(/'/g, "''")}'`
        );
        detail.value = { ...detail.value, ...objects(meta)[0] };
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
    } catch {
      scale.value = null;
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
      <div v-if="error" class="error">⚠ {{ error }}</div>
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
      <div v-if="dError" class="error">⚠ {{ dError }}</div>
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
  background: var(--bg-soft);
  padding: 12px;
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
  font-weight: 700;
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
  font-size: 11px;
  margin-top: 4px;
}
.links a {
  color: var(--accent);
  text-decoration: none;
}
.kpis {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}
.kpis div {
  display: flex;
  flex-direction: column;
}
.kpis b {
  font-size: 18px;
}
.kpis span {
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
h3 {
  margin: 0;
  font-size: 13px;
}
button.xs {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 6px;
}
.pad {
  padding: 18px;
}
</style>
