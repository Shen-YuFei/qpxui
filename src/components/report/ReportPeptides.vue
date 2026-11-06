<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import PeptideSeq from "../PeptideSeq.vue";
import ReportTable from "../ReportTable.vue";
import SpectrumViewer, { type PsmKey } from "../SpectrumViewer.vue";
import type { Column } from "../../lib/report";
import type { DatasetInfo } from "../../lib/api";
import {
  cachedSql,
  evidence,
  hasSpectra,
  ident,
  intensitySumExpr,
  likePattern,
  listText,
  lit,
  objects,
  proteinExpr,
  targetWhere,
  type DatasetTables,
} from "../../lib/report";
import { runSql } from "../../lib/duck";
import { openProtein, state } from "../../store";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string; accession?: string }>();

const LIMIT = 500;
const ev = evidence(props.t);
const prot = ev ? proteinExpr(ev) : null;
const evName = props.t.feature ? "features" : "PSMs";

const q = ref(state.search.peptides);
const mod = ref(state.search.mod);
const mode = ref<"contains" | "exact" | "prefix">("contains");
const minCharge = ref<number | null>(null);
const busy = ref(false);
const error = ref("");
const rows = ref<Record<string, any>[]>([]);
const truncated = ref(false);
const elapsed = ref(0);
const modNames = ref<string[]>([]);
const table = ref<InstanceType<typeof ReportTable> | null>(null);

// Runs for the peptide selected in the table.
const focus = ref<string | null>(null);
const evRows = ref<Record<string, any>[]>([]);
const evBusy = ref(false);

// PSM spectra: when the psm view stores peaks, the evidence pane lists PSMs
// (even if a feature view exists) and a row opens the spectrum viewer.
const spectra = ref(false);
const spectrum = ref<PsmKey | null>(null);
const evSrc = computed(() => (spectra.value && props.t.psm ? props.t.psm : ev));
const evLabel = computed(() => (evSrc.value === props.t.psm ? "PSMs" : "features"));
const evDetail = computed(() => `per-run ${evLabel.value}`);

const cols = computed<Column[]>(() =>
  [
    { key: "peptidoform", label: "Peptidoform" },
    { key: "protein", label: "Protein" },
    { key: "genes", label: "Genes" },
    { key: "charges", label: "Charges", fmt: (v: any) => listText(v, 6) },
    { key: "n_ev", label: evName === "features" ? "Features" : "PSMs", num: true },
    { key: "runs", label: "Runs", num: true },
    { key: "best_pep", label: "Best PEP", num: true, fmt: (v: any) => (v == null ? "" : Number(v).toExponential(1)) },
    { key: "log_int", label: "Mean log10 int.", num: true, fmt: (v: any) => (v == null ? "" : Number(v).toFixed(2)) },
  ].filter((c) => rows.value.length === 0 || c.key in rows.value[0])
);

const evCols = computed<Column[]>(() =>
  [
    { key: "run_file_name", label: "Run" },
    { key: "scan_no", label: "Scan", num: true, fmt: (v: any) => (v == null ? "" : String(v)) },
    { key: "charge", label: "z", num: true },
    { key: "rt_min", label: "RT (min)", num: true, fmt: (v: any) => (v == null ? "" : Number(v).toFixed(2)) },
    { key: "observed_mz", label: "m/z", num: true, fmt: (v: any) => (v == null ? "" : Number(v).toFixed(4)) },
    { key: "mass_error_ppm", label: "ppm", num: true, fmt: (v: any) => (v == null ? "" : Number(v).toFixed(2)) },
    { key: "posterior_error_probability", label: "PEP", num: true, fmt: (v: any) => (v == null ? "" : Number(v).toExponential(1)) },
    { key: "log_int", label: "log10 int.", num: true, fmt: (v: any) => (v == null ? "" : Number(v).toFixed(2)) },
  ].filter((c) => evRows.value.length === 0 || c.key in evRows.value[0])
);

function whereClause(): string {
  const E = ev!;
  const parts = [targetWhere(E)];
  // Strip anything that is not an amino-acid letter, so "pep tide" / lower case work.
  const s = q.value.trim().toUpperCase();
  if (s) {
    const aa = s.replace(/[^A-Z]/g, "");
    const seqCond =
      mode.value === "exact" ? `${E.seq} = ${lit(aa)}`
      : mode.value === "prefix" ? `starts_with(${E.seq}, ${lit(aa)})`
      : `contains(${E.seq}, ${lit(aa)})`;
    // Also match peptidoform text (e.g. "M[Oxidation]" or "UNIMOD:21").
    const pfCond = E.cols.has("peptidoform") && /[\[\]:+]/.test(q.value) ? ` OR peptidoform ILIKE ${likePattern(q.value.trim())}` : "";
    parts.push(`(${aa ? seqCond : "FALSE"}${pfCond})`);
  }
  if (mod.value && E.cols.has("modifications")) {
    parts.push(`list_contains(list_transform(modifications, x -> x.name), ${lit(mod.value)})`);
  }
  if (minCharge.value && E.cols.has("charge")) parts.push(`charge >= ${Number(minCharge.value)}`);
  return parts.join(" AND ");
}

async function search() {
  if (!ev) return;
  busy.value = true;
  error.value = "";
  focus.value = null;
  const t0 = performance.now();
  try {
    const E = ev;
    const has = (c: string) => E.cols.has(c);
    const isum = intensitySumExpr(E);
    const pf = has("peptidoform") ? "peptidoform" : E.seq;
    const sel = [
      `${pf} AS peptidoform`,
      `any_value(${E.seq}) AS sequence`,
      has("modifications") ? "any_value(modifications) AS modifications" : null,
      prot ? `any_value(${prot}) AS protein` : null,
      has("gg_names") ? "any_value(gg_names) AS genes" : null,
      has("charge") ? "list_sort(list_distinct(list(charge))) AS charges" : null,
      "count(*)::BIGINT AS n_ev",
      has("run_file_name") ? "count(DISTINCT run_file_name)::BIGINT AS runs" : null,
      has("posterior_error_probability") ? "min(posterior_error_probability) AS best_pep" : null,
      isum ? `avg(CASE WHEN ${isum} > 0 THEN log10(${isum}) END) AS log_int` : null,
    ].filter(Boolean);
    const r = await runSql(
      `SELECT ${sel.join(", ")} FROM ${ident(E.table)} WHERE ${whereClause()}
       GROUP BY 1 ORDER BY n_ev DESC, peptidoform LIMIT ${LIMIT + 1}`,
      LIMIT + 1
    );
    const out = objects(r);
    truncated.value = out.length > LIMIT;
    rows.value = out.slice(0, LIMIT);
    elapsed.value = performance.now() - t0;
  } catch (e: any) {
    error.value = String(e?.message ?? e);
  } finally {
    busy.value = false;
  }
}

async function openPeptide(row: Record<string, any>) {
  if (!ev) return;
  focus.value = row.peptidoform;
  evBusy.value = true;
  evRows.value = [];
  try {
    const E = evSrc.value!;
    const has = (c: string) => E.cols.has(c);
    const isum = intensitySumExpr(E);
    const pfCol = has("peptidoform") ? "peptidoform" : E.seq;
    const scanList = /\[\]|list/i.test(E.types.scan ?? "");
    const sel = [
      has("run_file_name") ? "run_file_name" : null,
      has("scan") ? (scanList ? "scan[1] AS scan_no" : "scan AS scan_no") : null,
      has("charge") ? "charge" : null,
      has("rt") ? "rt / 60.0 AS rt_min" : null,
      has("observed_mz") ? "observed_mz" : null,
      has("mass_error_ppm") ? "mass_error_ppm" : null,
      has("posterior_error_probability") ? "posterior_error_probability" : null,
      isum ? `CASE WHEN ${isum} > 0 THEN log10(${isum}) END AS log_int` : null,
    ].filter(Boolean);
    const r = await runSql(
      `SELECT ${sel.join(", ")} FROM ${ident(E.table)} WHERE ${targetWhere(E)} AND ${pfCol} = ${lit(String(row.peptidoform))}
       ORDER BY ${has("run_file_name") ? "run_file_name" : "1"}${has("posterior_error_probability") ? ", posterior_error_probability" : ""} LIMIT 5000`
    );
    evRows.value = objects(r).map((x, i) => ({ ...x, _k: i }));
  } finally {
    evBusy.value = false;
  }
}

function openSpectrum(row: Record<string, any>) {
  if (!spectra.value || !focus.value) return;
  spectrum.value = {
    peptidoform: focus.value,
    run_file_name: row.run_file_name ?? null,
    scan: row.scan_no ?? null,
    charge: row.charge ?? null,
  };
}

watch(
  () => state.search.nonce,
  () => {
    q.value = state.search.peptides;
    mod.value = state.search.mod;
    search();
  }
);

onMounted(async () => {
  if (!ev) return;
  hasSpectra(props.t.psm).then((v) => (spectra.value = v && !!props.t.psm?.cols.has("peptidoform"))).catch(() => {});
  if (ev.cols.has("modifications")) {
    try {
      const r = await cachedSql(
        props.ds,
        "ptm.mods",
        `SELECT m.name AS name, any_value(m.accession) AS accession,
                count(DISTINCT pf)::BIGINT AS n_pf, count(DISTINCT seq)::BIGINT AS n_pep, count(*)::BIGINT AS n_ev
         FROM (SELECT unnest(modifications) AS m, ${ev.cols.has("peptidoform") ? "peptidoform" : ev.seq} AS pf, ${ev.seq} AS seq
               FROM ${ident(ev.table)} WHERE ${targetWhere(ev)})
         GROUP BY 1 ORDER BY n_ev DESC`
      );
      modNames.value = r.rows.map((x) => String(x[0])).filter((x) => x && x !== "null");
    } catch {
      /* optional filter */
    }
  }
  search();
});
</script>

<template>
  <div v-if="!ev" class="muted pad">No feature or PSM view in this dataset.</div>
  <div v-else>
    <form class="bar" @submit.prevent="search">
      <input v-model="q" class="search mono" placeholder="Peptide sequence (e.g. LVNELTEFAK) or peptidoform text (M[Oxidation], UNIMOD:21)…" />
      <select v-model="mode" title="Sequence match">
        <option value="contains">contains</option>
        <option value="prefix">starts with</option>
        <option value="exact">exact</option>
      </select>
      <select v-if="modNames.length" v-model="mod" title="Only peptidoforms carrying this modification">
        <option value="">any modification</option>
        <option v-for="m in modNames" :key="m" :value="m">{{ m }}</option>
      </select>
      <input v-model.number="minCharge" type="number" min="1" max="9" placeholder="z ≥" class="z" title="Minimum charge" />
      <button class="primary" type="submit" :disabled="busy">Search</button>
      <button class="xs" type="button" :disabled="!rows.length" @click="table?.exportCsv()">CSV</button>
    </form>
    <div class="muted info">
      <span v-if="busy">Searching… <span class="spinner"></span></span>
      <span v-else>
        {{ rows.length.toLocaleString() }}{{ truncated ? "+" : "" }} peptidoforms
        <template v-if="truncated"> (top {{ LIMIT }} by {{ evName }} — refine the search)</template>
        · {{ (elapsed / 1000).toFixed(2) }} s · target {{ evName }} · click a peptidoform for its {{ spectra ? "PSMs and spectra" : evDetail }}, a protein to open it
      </span>
    </div>
    <div v-if="error" class="error">⚠ {{ error }}</div>
    <div v-else class="split" :class="{ open: !!focus }">
      <ReportTable
        ref="table"
        :columns="cols"
        :rows="rows"
        row-key="peptidoform"
        :selected="focus"
        clickable
        max-height="calc(100vh - 290px)"
        :file-name="`${fileBase}_peptidoforms${q ? '_' + q : ''}${mod ? '_' + mod : ''}`"
        @row="openPeptide"
      >
        <template #cell-peptidoform="{ row }">
          <PeptideSeq :peptidoform="row.peptidoform" :sequence="row.sequence" :modifications="row.modifications" />
        </template>
        <template #cell-protein="{ value }">
          <a v-if="value" class="mono link" href="#" @click.prevent.stop="openProtein(String(value))">{{ value }}</a>
        </template>
        <template #cell-genes="{ value }"><b>{{ listText(value) }}</b></template>
      </ReportTable>
      <div v-if="focus" class="detail">
        <div class="dhead">
          <PeptideSeq :peptidoform="focus" :sequence="rows.find((r) => r.peptidoform === focus)?.sequence" :modifications="rows.find((r) => r.peptidoform === focus)?.modifications" />
          <button class="xs" @click="focus = null">✕</button>
        </div>
        <div v-if="evBusy" class="muted"><span class="spinner"></span></div>
        <div v-if="!evBusy" class="muted hint">
          {{ evRows.length.toLocaleString() }}{{ evRows.length >= 5000 ? "+" : "" }} {{ evLabel }}<template v-if="spectra"> · click a PSM to view its annotated spectrum</template>
        </div>
        <ReportTable
          v-if="!evBusy"
          :columns="evCols"
          :rows="evRows"
          row-key="_k"
          :clickable="spectra"
          max-height="calc(100vh - 360px)"
          :file-name="`${fileBase}_${focus}_${spectra ? 'psms' : evName}`"
          @row="openSpectrum"
        />
      </div>
    </div>
    <SpectrumViewer
      v-if="spectrum && t.psm"
      :psm="t.psm"
      :target="spectrum"
      :accession="accession"
      :file-base="fileBase"
      @close="spectrum = null"
    />
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.search {
  flex: 1;
  min-width: 260px;
}
.z {
  width: 70px;
}
.info {
  font-size: 12px;
  margin-bottom: 8px;
}
.split {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
.split.open {
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
}
.detail {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  align-self: start;
}
.dhead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.link {
  color: var(--accent);
  text-decoration: none;
}
button.xs {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 6px;
}
.pad {
  padding: 18px;
}
.hint {
  font-size: 11px;
}
</style>
