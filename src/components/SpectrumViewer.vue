<script setup lang="ts">
// Annotated PSM spectrum viewer (PRIDE USI viewer style): stick plot with b/y
// ion labels, fragment coverage map, mass-error panel and fragment ion table.
// Only the selected PSM's peak arrays are read from the (possibly streamed) file.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import VChart from "vue-echarts";
import PeptideSeq from "./PeptideSeq.vue";
import CoverageMap from "./spectrum/CoverageMap.vue";
import FragmentIonTable from "./spectrum/FragmentIonTable.vue";
import MirrorControls from "./spectrum/MirrorControls.vue";
import { chartTheme, toCsv } from "../lib/charts";
import { spectrumOption } from "../lib/spectrumChart";
import { savePng, saveText } from "../lib/export";
import { settings } from "../lib/settings";
import type { TableRef } from "../lib/report";
import { psmRecord, type PsmKey } from "../lib/queries/spectrum";
import { cvMap } from "../lib/qpx";
import { useMirror } from "../lib/useMirror";
import { annotatePeaks, fragmentIons, parsePeptidoform, precursorMz, storedAnnotations, toProForma, type Peak, type Tolerance } from "../lib/fragments";
import { coverageMarks, ionTableCharges, ionTableRows, matchedIonKeys, spectrumStats } from "../lib/spectrumSummary";

const props = defineProps<{ psm: TableRef; target: PsmKey; accession?: string; fileBase?: string }>();
const emit = defineEmits<{ (e: "close"): void }>();

const loading = ref(true);
const error = ref("");
const rec = ref<Record<string, any> | null>(null);
const source = ref<"file" | "computed">("computed");
const tolValue = ref(20);
const tolUnit = ref<Tolerance["unit"]>("ppm");
const maxCharge = ref(1);
const losses = ref(true);
const showLabels = ref(true);
const chart = ref<InstanceType<typeof VChart> | null>(null);
const msg = ref("");

const hasStored = computed(() => Array.isArray(rec.value?.ion_type_array) && rec.value!.ion_type_array.some((x: unknown) => x));
const charge = computed(() => Number(rec.value?.charge ?? props.target.charge ?? 2) || 2);
const parsed = computed(() => parsePeptidoform(String(rec.value?.peptidoform ?? props.target.peptidoform)));
const scan = computed(() => {
  const s = rec.value?.scan ?? props.target.scan;
  return Array.isArray(s) ? s[0] : s;
});
const cv = computed<Record<string, string>>(() => cvMap(rec.value?.cv_params));

const tol = computed<Tolerance>(() => ({ value: Number(tolValue.value) || 20, unit: tolUnit.value }));
const ions = computed(() =>
  fragmentIons(parsed.value, source.value === "file" ? Math.max(charge.value, 1) : maxCharge.value, losses.value || source.value === "file", source.value === "file")
);

const peaks = computed<Peak[]>(() => {
  const r = rec.value;
  if (!r || !Array.isArray(r.mz_array)) return [];
  const mz = (r.mz_array as number[]).map(Number);
  const inten = ((r.intensity_array ?? []) as number[]).map(Number);
  if (source.value === "file" && hasStored.value) {
    return storedAnnotations(mz, inten, r.ion_type_array ?? [], r.charge_array ?? [], ions.value, tolUnit.value);
  }
  return annotatePeaks(mz, inten, ions.value, tol.value);
});

const matchedKeys = computed(() => matchedIonKeys(peaks.value));

const stats = computed(() => spectrumStats(parsed.value, peaks.value));

const theoMz = computed(() => precursorMz(parsed.value, charge.value));

const proforma = computed(() => toProForma(parsed.value));

const pxd = computed(() => {
  const m = /^(PXD|MSV|PDC|IPX)\d+/i.exec(props.accession ?? "");
  return m ? m[0].toUpperCase() : "";
});
const usi = computed(() => {
  const run = rec.value?.run_file_name ?? props.target.run_file_name;
  if (!pxd.value || !run || scan.value == null) return "";
  return `mzspec:${pxd.value}:${run}:scan:${scan.value}:${proforma.value}/${charge.value}`;
});
const prideUrl = computed(() => (usi.value && /^(PXD|MSV)/.test(pxd.value) ? `https://www.ebi.ac.uk/pride/archive/usi?usi=${encodeURIComponent(usi.value)}` : ""));

// ---- Mirror (reference) spectrum, drawn downwards ----
const { mirrorMode, mirror, mirrorBusy, mirrorError, otherPsms, otherIdx, koinaModel, nce, usiInput, koinaWhy, sim, loadMirror } = useMirror({
  psm: () => props.psm,
  target: () => props.target,
  rec,
  parsed,
  charge,
  scan,
  tol,
  tolUnit,
  source,
  peaks,
  usi,
});

// Cleavage marks for the coverage map: after residue k (1-based), b_k and y_(n-k).
const coverage = computed(() => coverageMarks(parsed.value, peaks.value));

// Fragment ion table (USI viewer / Lorikeet style).
const tableCharges = computed(() => ionTableCharges(ions.value));
const ionTable = computed(() => ionTableRows(parsed.value, ions.value, matchedKeys.value, tableCharges.value));

const option = computed(() => {
  void settings.theme;
  const { dim, border } = chartTheme();
  return spectrumOption({
    peaks: peaks.value,
    mirror: mirror.value,
    precursorMz: theoMz.value,
    showLabels: showLabels.value,
    unit: tolUnit.value,
    tolerance: source.value === "file" ? (tolUnit.value === "Da" ? 0.02 : 20) : tol.value.value,
    colors: { dim, border, grey: settings.theme === "light" ? "#94a3b8" : "#64748b" },
  });
});

let loadSeq = 0;
async function load() {
  const id = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const row = await psmRecord(props.psm, props.target);
    if (id !== loadSeq) return;
    if (!row) throw new Error("PSM not found in the psm view.");
    if (!Array.isArray(row.mz_array) || !row.mz_array.length) throw new Error("This PSM has no stored peaks (mz_array is empty).");
    rec.value = row;
    otherPsms.value = [];
    otherIdx.value = -1;
    const nceCv = Number(cvOf(row, "normalized collision energy"));
    if (Number.isFinite(nceCv) && nceCv > 0) nce.value = Math.round(nceCv);
    const z = Number(row.charge ?? 2) || 2;
    maxCharge.value = Math.max(1, Math.min(2, z - 1));
    source.value = Array.isArray(row.ion_type_array) && row.ion_type_array.some((x: unknown) => x) ? "file" : "computed";
    const analyzer = String(cvOf(row, "mass analyzer") ?? "");
    const trap = /ITMS|ion trap/i.test(analyzer);
    tolValue.value = trap ? 0.5 : 20;
    tolUnit.value = trap ? "Da" : "ppm";
    if (mirrorMode.value === "usi") usiInput.value = usi.value;
  } catch (e: any) {
    if (id === loadSeq) error.value = String(e?.message ?? e);
  } finally {
    if (id === loadSeq) loading.value = false;
  }
  if (id === loadSeq && rec.value) loadMirror();
}

function cvOf(row: Record<string, any>, name: string): string | undefined {
  return cvMap(row.cv_params)[name];
}

function flash(t: string) {
  msg.value = t;
  window.setTimeout(() => (msg.value = ""), 2500);
}

const fileName = computed(() => `${props.fileBase ? props.fileBase + "_" : ""}${parsed.value.residues.join("")}_${charge.value}_scan${scan.value ?? ""}`);

async function exportPng() {
  const inst = (chart.value as any)?.chart;
  if (!inst) return;
  const bg = chartTheme().bg;
  try {
    if (await savePng(fileName.value, inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: bg }))) flash("Saved");
  } catch (e) {
    flash(String(e));
  }
}

async function exportCsv() {
  const rows = peaks.value.map((p) => [p.mz, p.intensity, p.ion?.label ?? "", p.ion?.charge ?? "", Number.isFinite(p.ion?.mz) ? p.ion!.mz : "", Number.isFinite(p.error) ? p.error : ""]);
  try {
    if (await saveText(fileName.value, toCsv(["mz", "intensity", "ion", "ion_charge", "theoretical_mz", `error_${tolUnit.value}`], rows))) flash("Saved");
  } catch (e) {
    flash(String(e));
  }
}

async function copyUsi() {
  try {
    await navigator.clipboard.writeText(usi.value);
    flash("USI copied");
  } catch {
    flash("Copy failed");
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}

watch(() => props.target, load, { deep: true });
onMounted(() => {
  window.addEventListener("keydown", onKey);
  load();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel">
      <div class="head">
        <div class="title">
          <PeptideSeq :peptidoform="String(rec?.peptidoform ?? target.peptidoform)" />
          <span class="chip">{{ charge }}+</span>
        </div>
        <div class="acts">
          <span v-if="msg" class="muted msg">{{ msg }}</span>
          <button class="xs" :disabled="!rec" title="Save the annotated spectrum as PNG" @click="exportPng">PNG</button>
          <button class="xs" :disabled="!rec" title="Save peaks and annotations as CSV" @click="exportCsv">CSV</button>
          <button class="xs" title="Close (Esc)" @click="emit('close')">✕</button>
        </div>
      </div>

      <div v-if="loading" class="state muted"><span class="spinner"></span> Reading peaks…</div>
      <div v-else-if="error" class="state error">⚠ {{ error }}</div>
      <template v-else-if="rec">
        <div class="meta">
          <span v-if="rec.run_file_name" class="mono" :title="rec.run_file_name">{{ rec.run_file_name }}</span>
          <span v-if="scan != null">scan <b>{{ scan }}</b></span>
          <span v-if="rec.rt != null">RT <b>{{ (Number(rec.rt) / 60).toFixed(2) }}</b> min</span>
          <span v-if="rec.observed_mz != null">obs. m/z <b>{{ Number(rec.observed_mz).toFixed(4) }}</b></span>
          <span title="Computed from the peptidoform">theo. m/z <b>{{ theoMz.toFixed(4) }}</b></span>
          <span v-if="rec.posterior_error_probability != null">PEP <b>{{ Number(rec.posterior_error_probability).toExponential(1) }}</b></span>
          <span v-if="cv.instrument">{{ cv.instrument }}</span>
          <span v-if="cv['dissociation method']">{{ cv["dissociation method"] }}<template v-if="cv['normalized collision energy']"> @ NCE {{ cv["normalized collision energy"] }}</template></span>
        </div>
        <div v-if="usi" class="usi">
          <code class="mono" :title="usi">{{ usi }}</code>
          <button class="xs" @click="copyUsi">Copy USI</button>
          <a v-if="prideUrl" :href="prideUrl" target="_blank" rel="noreferrer">PRIDE USI viewer ↗</a>
        </div>
        <div v-if="parsed.unknown.length" class="warn">Unknown residue/modification mass (treated as 0): {{ parsed.unknown.join(", ") }}</div>

        <div class="controls">
          <label v-if="hasStored" title="Annotations stored in the file (spectrum_utils) or computed here">
            Annotation
            <select v-model="source">
              <option value="file">from file</option>
              <option value="computed">computed</option>
            </select>
          </label>
          <template v-if="source === 'computed'">
            <label>Tolerance <input v-model.number="tolValue" type="number" min="0" step="any" class="num" /></label>
            <select v-model="tolUnit">
              <option value="ppm">ppm</option>
              <option value="Da">Da</option>
            </select>
            <label>Fragment z ≤
              <select v-model.number="maxCharge">
                <option v-for="z in Math.max(1, charge)" :key="z" :value="z">{{ z }}</option>
              </select>
            </label>
            <label><input v-model="losses" type="checkbox" /> H₂O/NH₃ losses</label>
          </template>
          <template v-else>
            <label>Error unit
              <select v-model="tolUnit">
                <option value="ppm">ppm</option>
                <option value="Da">Da</option>
              </select>
            </label>
          </template>
          <label><input v-model="showLabels" type="checkbox" /> Labels</label>
          <span class="muted stats">
            {{ stats.annotated }}/{{ stats.peaks }} peaks annotated · {{ stats.ticPct.toFixed(1) }}% TIC ·
            b {{ stats.b }} · y {{ stats.y }} · {{ stats.cleav }}/{{ Math.max(stats.n - 1, 0) }} cleavages
          </span>
        </div>

        <MirrorControls
          v-model:mode="mirrorMode"
          v-model:other-idx="otherIdx"
          v-model:koina-model="koinaModel"
          v-model:nce="nce"
          v-model:usi-input="usiInput"
          :other-psms="otherPsms"
          :busy="mirrorBusy"
          :error="mirrorError"
          :koina-why="koinaWhy"
          :sim="sim"
          @load="loadMirror"
        />

        <CoverageMap :marks="coverage" />

        <div class="chartbox">
          <VChart ref="chart" :option="option" autoresize class="chart" />
        </div>

        <FragmentIonTable :charges="tableCharges" :rows="ionTable" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.55);
  z-index: 50;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 28px 20px;
  overflow: auto;
}
.panel {
  width: min(1180px, 100%);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  overflow: hidden;
}
.chip {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.acts {
  display: flex;
  gap: 4px;
  align-items: center;
}
.msg {
  font-size: 11px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--text-dim);
}
.meta .mono {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta b {
  color: var(--text);
}
.usi {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.usi code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 8px;
}
.usi a {
  color: var(--accent);
  white-space: nowrap;
}
.warn {
  font-size: 12px;
  color: var(--warn);
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  align-items: center;
  font-size: 12px;
}
.controls label {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.num {
  width: 64px;
}
.stats {
  margin-left: auto;
}
.error {
  color: var(--danger, #ef4444);
}
.chartbox {
  height: 470px;
}
.chart {
  width: 100%;
  height: 100%;
}
.state {
  padding: 40px;
  text-align: center;
  font-size: 13px;
}
button.xs {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 6px;
}
</style>
