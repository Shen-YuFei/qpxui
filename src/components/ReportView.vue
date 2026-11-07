<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { openReport, state, type ReportTab } from "../store";
import type { DatasetInfo } from "../lib/api";
import {
  cachedSql,
  datasetTables,
  evidence,
  fmtShort,
  ident,
  objects,
  proteinExpr,
  targetWhere,
  viewScale,
  type DatasetTables,
  type TableRef,
} from "../lib/report";
import { saveText } from "../lib/export";
import ReportOverview from "./report/ReportOverview.vue";
import ReportQC from "./report/ReportQC.vue";
import ReportPTMs from "./report/ReportPTMs.vue";
import ReportSamples from "./report/ReportSamples.vue";
import ReportProteins from "./report/ReportProteins.vue";
import ReportPeptides from "./report/ReportPeptides.vue";
import ReportQuant from "./report/ReportQuant.vue";

const props = defineProps<{ ds: DatasetInfo }>();

const tables = ref<DatasetTables | null>(null);
const error = ref("");
const loading = ref(true);
const meta = ref<Record<string, any>>({});
const runMeta = ref<{ instruments: string[]; enzymes: string[]; organisms: string[] }>({ instruments: [], enzymes: [], organisms: [] });

interface Kpi {
  key: string;
  label: string;
  value: number | null;
  title?: string;
  /** Deferred whole-file count on a large streamed view. */
  defer?: () => Promise<number | null>;
  busy?: boolean;
}
const kpis = ref<Kpi[]>([]);

const TABS: { id: ReportTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "qc", label: "QC" },
  { id: "ptms", label: "PTMs" },
  { id: "samples", label: "Samples" },
  { id: "proteins", label: "Proteins" },
  { id: "quant", label: "Quantification" },
  { id: "peptides", label: "Peptidoforms" },
];

// Only show tabs the dataset's views can support.
const tabs = computed(() => {
  const t = tables.value;
  if (!t) return TABS;
  const ev = evidence(t);
  const ok: Record<ReportTab, boolean> = {
    overview: !!ev,
    qc: !!ev?.cols.has("run_file_name"),
    ptms: !!ev?.cols.has("modifications"),
    samples: !!(t.sample || t.run),
    proteins: !!(t.pg || (ev && proteinExpr(ev))),
    peptides: !!ev,
    quant: !!(t.pg?.cols.has("intensities") || t.feature?.cols.has("intensities")),
  };
  return TABS.filter((x) => ok[x.id]);
});

watch(tabs, (list) => {
  if (list.length && !list.some((x) => x.id === state.reportTab)) state.reportTab = list[0].id;
});

const accession = computed(() => String(meta.value.project_accession && meta.value.project_accession !== "unknown" ? meta.value.project_accession : props.ds.prefix));
const fileBase = computed(() => props.ds.prefix);

async function load() {
  loading.value = true;
  error.value = "";
  tables.value = null;
  meta.value = {};
  kpis.value = [];
  runMeta.value = { instruments: [], enzymes: [], organisms: [] };
  try {
    const t = await datasetTables(props.ds);
    tables.value = t;
    loading.value = false;
    await loadHeader(t);
  } catch (e: any) {
    error.value = String(e?.message ?? e);
    loading.value = false;
  }
}

async function count(key: string, sql: string): Promise<number | null> {
  try {
    const r = await cachedSql(props.ds, key, sql);
    return Number(r.rows[0]?.[0] ?? 0);
  } catch {
    return null;
  }
}

/** Row count of a view from its parquet footer (no data read). */
async function footerRows(ref: TableRef): Promise<number | null> {
  try {
    return (await viewScale(ref)).rows;
  } catch {
    return null;
  }
}

async function isLarge(ref: TableRef | undefined): Promise<boolean> {
  if (!ref) return false;
  try {
    return (await viewScale(ref)).large;
  } catch {
    return false;
  }
}

async function compute(k: Kpi) {
  const f = k.defer;
  if (!f) return;
  k.defer = undefined;
  k.value = null;
  k.title = undefined;
  k.busy = true;
  kpis.value = [...kpis.value];
  try {
    k.value = await f();
  } finally {
    k.busy = false;
    kpis.value = [...kpis.value];
  }
}

async function loadHeader(t: DatasetTables) {
  if (t.dataset) {
    try {
      const sel = ["project_accession", "project_title", "project_description", "pubmed_id", "software_name", "software_version", "creation_date"]
        .filter((c) => t.dataset!.cols.has(c));
      if (sel.length) {
        const r = await cachedSql(props.ds, "hdr.dataset", `SELECT ${sel.join(", ")} FROM ${ident(t.dataset.table)} LIMIT 1`);
        meta.value = objects(r)[0] ?? {};
      }
    } catch {
      /* optional */
    }
  }
  const list: Kpi[] = [];
  const push = (k: Kpi) => {
    list.push(k);
    kpis.value = [...list];
  };
  const ev = evidence(t);
  // Distinct counts read whole columns; on a large streamed view they wait
  // for a click. Plain row counts come from the parquet footer.
  const distinct = async (ref: TableRef, k: Omit<Kpi, "value">, key: string, sql: string) => {
    const run = () => count(key, sql);
    if (await isLarge(ref)) push({ ...k, value: null, defer: run, title: "Large streamed view: click to count (reads a whole column)" });
    else push({ ...k, value: await run() });
  };
  const rows = async (ref: TableRef, key: string) =>
    (await isLarge(ref)) ? footerRows(ref) : count(key, `SELECT count(*) FROM ${ident(ref.table)}`);
  if (t.pg) {
    await distinct(t.pg, { key: "pg", label: "Protein groups", title: "Distinct anchor proteins (target) in the pg view" }, "kpi.pg", `SELECT count(DISTINCT anchor_protein) FROM ${ident(t.pg.table)} WHERE ${targetWhere(t.pg)}`);
  } else if (ev && proteinExpr(ev)) {
    await distinct(ev, { key: "pg", label: "Proteins" }, "kpi.prot", `SELECT count(DISTINCT ${proteinExpr(ev)}) FROM ${ident(ev.table)} WHERE ${targetWhere(ev)}`);
  }
  if (ev && ev.seq !== "NULL") {
    await distinct(ev, { key: "pep", label: "Peptides", title: "Distinct target peptide sequences" }, "kpi.pep", `SELECT count(DISTINCT ${ev.seq}) FROM ${ident(ev.table)} WHERE ${targetWhere(ev)}`);
  }
  if (t.feature) push({ key: "feat", label: "Features", value: await rows(t.feature, "kpi.feat") });
  if (t.psm) push({ key: "psm", label: "PSMs", value: await rows(t.psm, "kpi.psm") });
  if (t.run) push({ key: "run", label: "Runs", value: await count("kpi.run", `SELECT count(*) FROM ${ident(t.run.table)}`) });
  else if (ev?.cols.has("run_file_name")) await distinct(ev, { key: "run", label: "Runs" }, "kpi.run2", `SELECT count(DISTINCT run_file_name) FROM ${ident(ev.table)}`);
  if (t.sample) push({ key: "smp", label: "Samples", value: await count("kpi.smp", `SELECT count(*) FROM ${ident(t.sample.table)}`) });

  try {
    if (t.run) {
      const c = t.run.cols;
      const parts = [
        c.has("instrument") ? "list_sort(list_distinct(list(instrument))) AS instruments" : "[]::VARCHAR[] AS instruments",
        c.has("enzymes") ? "list_sort(list_distinct(flatten(list(enzymes)))) AS enzymes" : "[]::VARCHAR[] AS enzymes",
      ];
      const r = objects(await cachedSql(props.ds, "hdr.run", `SELECT ${parts.join(", ")} FROM ${ident(t.run.table)}`))[0];
      runMeta.value.instruments = (r?.instruments ?? []).filter(Boolean);
      runMeta.value.enzymes = (r?.enzymes ?? []).filter(Boolean);
    }
    if (t.sample?.cols.has("organism")) {
      const r = await cachedSql(props.ds, "hdr.org", `SELECT DISTINCT organism FROM ${ident(t.sample.table)} WHERE organism IS NOT NULL ORDER BY 1`);
      runMeta.value.organisms = r.rows.map((x) => String(x[0]));
    }
  } catch {
    /* optional */
  }
}

watch(() => props.ds, load, { immediate: true });

// ---- citation ----
const citeOpen = ref(false);
const cited = ref("");
const pxUrl = computed(() => (/^PXD\d+$/.test(accession.value) ? `https://www.ebi.ac.uk/pride/archive/projects/${accession.value}` : null));
const pubmed = computed(() => (meta.value.pubmed_id ? String(meta.value.pubmed_id) : ""));
const citationText = computed(() => {
  const title = meta.value.project_title || props.ds.prefix;
  const sw = [meta.value.software_name, meta.value.software_version].filter(Boolean).join(" ");
  return `${title}. ${accession.value}${pxUrl.value ? ` (${pxUrl.value})` : ""}${pubmed.value ? `. PMID: ${pubmed.value}` : ""}. Reanalysed with ${sw || "quantms"} and distributed in QPX format by the quantms portal (https://portal.quantms.org).`;
});
const bibtex = computed(() => `@misc{${accession.value.replace(/\W/g, "")},
  title        = {${meta.value.project_title || props.ds.prefix}},
  howpublished = {${pxUrl.value ?? accession.value}},
  note         = {${accession.value}; QPX reanalysis by ${meta.value.software_name || "quantms"}${pubmed.value ? `; PMID ${pubmed.value}` : ""}},
  year         = {${String(meta.value.creation_date ?? "").slice(0, 4) || new Date().getFullYear()}}
}
`);
const ris = computed(() => `TY  - DATA
TI  - ${meta.value.project_title || props.ds.prefix}
ID  - ${accession.value}
${pxUrl.value ? `UR  - ${pxUrl.value}\n` : ""}${pubmed.value ? `N1  - PMID ${pubmed.value}\n` : ""}PB  - quantms / PRIDE
ER  -
`);
async function copyCitation() {
  try {
    await navigator.clipboard.writeText(citationText.value);
    cited.value = "Copied";
  } catch {
    cited.value = "Copy failed";
  }
  window.setTimeout(() => (cited.value = ""), 2000);
}

const descOpen = ref(false);
</script>

<template>
  <div class="report">
    <div v-if="error" class="error pad">⚠ {{ error }}</div>
    <div v-else-if="loading" class="pad muted">Opening dataset views… <span class="spinner"></span></div>
    <template v-else-if="tables">
      <header class="hdr">
        <div class="ident">
          <div class="acc mono">{{ accession }}<span v-if="accession !== ds.prefix" class="muted"> · {{ ds.prefix }}</span></div>
          <h2>{{ meta.project_title || "QPX dataset report" }}</h2>
          <p v-if="meta.project_description" class="desc muted" :class="{ open: descOpen }" @click="descOpen = !descOpen">{{ meta.project_description }}</p>
          <div class="facts">
            <span v-if="runMeta.organisms.length"><b>Organisms</b> {{ runMeta.organisms.join(", ") }}</span>
            <span v-if="runMeta.instruments.length"><b>Instruments</b> {{ runMeta.instruments.join(", ") }}</span>
            <span v-if="runMeta.enzymes.length"><b>Enzymes</b> {{ runMeta.enzymes.join(", ") }}</span>
            <span v-if="meta.software_name"><b>Software</b> {{ meta.software_name }} {{ meta.software_version ?? "" }}</span>
            <a v-if="pxUrl" :href="pxUrl" target="_blank" rel="noreferrer">PRIDE {{ accession }} ↗</a>
            <a v-if="pubmed" :href="`https://pubmed.ncbi.nlm.nih.gov/${pubmed}`" target="_blank" rel="noreferrer">PubMed {{ pubmed }} ↗</a>
            <button class="xs" @click="citeOpen = !citeOpen">Cite this data</button>
          </div>
          <div v-if="citeOpen" class="cite">
            <p class="mono">{{ citationText }}</p>
            <div class="cite-acts">
              <span class="muted">Please cite the original data and quantms.</span>
              <span v-if="cited" class="muted">{{ cited }}</span>
              <button class="xs" @click="copyCitation">Copy citation</button>
              <button class="xs" @click="saveText(`${accession}`, bibtex, 'bib')">BibTeX</button>
              <button class="xs" @click="saveText(`${accession}`, ris, 'ris')">RIS</button>
            </div>
          </div>
        </div>
        <div class="kpis">
          <div v-for="k in kpis" :key="k.key" class="kpi" :title="k.title ?? (k.value ?? 0).toLocaleString()">
            <div v-if="k.defer" class="kv"><button class="xs" @click="compute(k)">count</button></div>
            <div v-else-if="k.busy" class="kv"><span class="spinner"></span></div>
            <div v-else class="kv">{{ k.value === null ? "–" : fmtShort(k.value) }}</div>
            <div class="kl">{{ k.label }}</div>
          </div>
          <div v-if="!kpis.length" class="muted"><span class="spinner"></span></div>
        </div>
      </header>

      <nav class="tabs">
        <button v-for="tb in tabs" :key="tb.id" :class="{ active: state.reportTab === tb.id }" @click="openReport(tb.id)">{{ tb.label }}</button>
      </nav>

      <section class="tab-body">
        <!-- KeepAlive: switching tabs keeps charts and search results. -->
        <KeepAlive>
          <ReportOverview v-if="state.reportTab === 'overview'" :key="ds.path + ds.prefix + 'ov'" :ds="ds" :t="tables" :file-base="fileBase" />
          <ReportQC v-else-if="state.reportTab === 'qc'" :key="ds.path + ds.prefix + 'qc'" :ds="ds" :t="tables" :file-base="fileBase" />
          <ReportPTMs v-else-if="state.reportTab === 'ptms'" :key="ds.path + ds.prefix + 'ptm'" :ds="ds" :t="tables" :file-base="fileBase" />
          <ReportSamples v-else-if="state.reportTab === 'samples'" :key="ds.path + ds.prefix + 'smp'" :ds="ds" :t="tables" :file-base="fileBase" />
          <ReportProteins v-else-if="state.reportTab === 'proteins'" :key="ds.path + ds.prefix + 'prot'" :ds="ds" :t="tables" :file-base="fileBase" />
          <ReportQuant v-else-if="state.reportTab === 'quant'" :key="ds.path + ds.prefix + 'quant'" :ds="ds" :t="tables" :file-base="fileBase" />
          <ReportPeptides v-else :key="ds.path + ds.prefix + 'pep'" :ds="ds" :t="tables" :file-base="fileBase" :accession="accession" />
        </KeepAlive>
      </section>
    </template>
  </div>
</template>

<style scoped>
.report {
  padding: 16px 18px 28px;
}
.hdr {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.ident {
  flex: 1 1 420px;
  min-width: 0;
}
.acc {
  font-size: 12px;
  color: var(--accent);
  font-weight: 700;
}
h2 {
  margin: 2px 0 6px;
  font-size: 18px;
}
.desc {
  font-size: 12px;
  margin: 0 0 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  cursor: pointer;
}
.desc.open {
  -webkit-line-clamp: unset;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 12px;
  align-items: center;
}
.facts b {
  color: var(--text-dim);
  font-weight: 600;
  margin-right: 4px;
}
.facts a {
  color: var(--accent);
  text-decoration: none;
}
.cite {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-panel);
}
.cite p {
  margin: 0 0 6px;
  font-size: 11px;
  white-space: pre-wrap;
}
.cite-acts {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  flex-wrap: wrap;
}
.kpis {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: flex-start;
}
.kpi {
  min-width: 104px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-panel);
}
.kv {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.kl {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-dim);
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
}
.tabs button {
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  padding: 8px 14px;
  color: var(--text-dim);
}
.tabs button.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 700;
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
