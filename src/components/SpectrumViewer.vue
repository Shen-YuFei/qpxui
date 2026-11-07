<script setup lang="ts">
// Annotated PSM spectrum viewer (PRIDE USI viewer style): stick plot with b/y
// ion labels, fragment coverage map, mass-error panel and fragment ion table.
// Only the selected PSM's peak arrays are read from the (possibly streamed) file.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import VChart from "vue-echarts";
import PeptideSeq from "./PeptideSeq.vue";
import { chartTheme, toCsv } from "../lib/charts";
import { spectrumOption } from "../lib/spectrumChart";
import { savePng, saveText } from "../lib/export";
import { settings } from "../lib/settings";
import type { TableRef } from "../lib/report";
import { peptidoformPsms, psmPeaks, psmRecord, type PsmKey } from "../lib/queries/spectrum";
import { cvMap } from "../lib/qpx";
import {
  KOINA_MODELS,
  fetchUsi,
  koinaPredict,
  koinaSequence,
  pickKoinaModel,
  similarity,
  theoretical,
  type MirrorSpectrum,
} from "../lib/mirror";
import {
  annotatePeaks,
  fragmentIons,
  ionKey,
  parsePeptidoform,
  precursorMz,
  storedAnnotations,
  toProForma,
  type Peak,
  type Tolerance,
} from "../lib/fragments";

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

// ---- Mirror (reference) spectrum, drawn downwards ----
type MirrorMode = "none" | "psm" | "theoretical" | "predicted" | "usi";
const mirrorMode = ref<MirrorMode>("none");
const mirror = ref<MirrorSpectrum | null>(null);
const mirrorBusy = ref(false);
const mirrorError = ref("");
const otherPsms = ref<Record<string, any>[]>([]);
const otherIdx = ref<number>(-1);
const koinaModel = ref(KOINA_MODELS[0].id);
const nce = ref(27);
const usiInput = ref("");
let mirrorAbort: AbortController | null = null;

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

const matchedKeys = computed(() => {
  const s = new Set<string>();
  for (const p of peaks.value) if (p.ion) s.add(ionKey(p.ion.type, p.ion.num, p.ion.loss, p.ion.charge));
  return s;
});

const stats = computed(() => {
  const n = parsed.value.residues.length;
  const tic = peaks.value.reduce((a, p) => a + p.intensity, 0) || 1;
  const ann = peaks.value.filter((p) => p.ion);
  const bNums = new Set(ann.filter((p) => p.ion!.type === "b").map((p) => p.ion!.num));
  const yNums = new Set(ann.filter((p) => p.ion!.type === "y").map((p) => p.ion!.num));
  // A backbone cleavage is explained if either the b or the complementary y ion is seen.
  let cleav = 0;
  for (let k = 1; k < n; k++) if (bNums.has(k) || yNums.has(n - k)) cleav++;
  return {
    peaks: peaks.value.length,
    annotated: ann.length,
    ticPct: (ann.reduce((a, p) => a + p.intensity, 0) / tic) * 100,
    b: bNums.size,
    y: yNums.size,
    cleav,
    n,
  };
});

const theoMz = computed(() => precursorMz(parsed.value, charge.value));

const koinaWhy = computed(() => {
  const m = KOINA_MODELS.find((x) => x.id === koinaModel.value)!;
  return koinaSequence(parsed.value, m).why ?? "";
});

/** Similarity between the PSM and the mirror (not for the theoretical ladder,
 * whose intensities are arbitrary). */
const sim = computed(() => {
  if (!mirror.value || mirrorMode.value === "theoretical" || !peaks.value.length) return null;
  const t: Tolerance = source.value === "file" ? { value: tolUnit.value === "Da" ? 0.02 : 20, unit: tolUnit.value } : tol.value;
  return similarity(peaks.value, mirror.value.peaks, t);
});

function psmLabel(r: Record<string, any>): string {
  const sc = Array.isArray(r.scan) ? r.scan[0] : r.scan;
  const parts = [r.run_file_name ? String(r.run_file_name) : "", sc != null ? `scan ${sc}` : "", r.charge != null ? `${r.charge}+` : ""];
  if (r.posterior_error_probability != null) parts.push(`PEP ${Number(r.posterior_error_probability).toExponential(1)}`);
  return parts.filter(Boolean).join(" · ");
}

async function listOtherPsms() {
  const pf = String(rec.value?.peptidoform ?? props.target.peptidoform);
  const r = await peptidoformPsms(props.psm, pf);
  const curScan = scan.value;
  const curRun = rec.value?.run_file_name ?? props.target.run_file_name;
  otherPsms.value = r.filter((x) => {
    const sc = Array.isArray(x.scan) ? x.scan[0] : x.scan;
    return !(sc == curScan && (x.run_file_name ?? null) == (curRun ?? null) && (x.charge == null || x.charge == charge.value));
  });
}

async function loadMirror() {
  mirrorAbort?.abort();
  mirror.value = null;
  mirrorError.value = "";
  if (mirrorMode.value === "none" || !rec.value) return;
  const ctrl = (mirrorAbort = new AbortController());
  mirrorBusy.value = true;
  try {
    let out: MirrorSpectrum | null = null;
    if (mirrorMode.value === "theoretical") {
      out = theoretical(parsed.value, Math.max(1, Math.min(2, charge.value - 1)));
    } else if (mirrorMode.value === "predicted") {
      const m = KOINA_MODELS.find((x) => x.id === koinaModel.value)!;
      if (koinaWhy.value) return;
      out = await koinaPredict(parsed.value, charge.value, m, Number(nce.value) || 27, ctrl.signal);
    } else if (mirrorMode.value === "usi") {
      if (!usiInput.value.trim()) return;
      out = await fetchUsi(usiInput.value, tol.value, { parsed: parsed.value, charge: charge.value }, ctrl.signal);
    } else if (mirrorMode.value === "psm") {
      if (!otherPsms.value.length) await listOtherPsms();
      if (otherIdx.value < 0 && otherPsms.value.length) otherIdx.value = 0;
      const o = otherPsms.value[otherIdx.value];
      if (!o) throw new Error("No other PSM of this peptidoform in the psm view.");
      out = await loadOtherPsm(o);
    }
    if (!ctrl.signal.aborted) mirror.value = out;
  } catch (e: any) {
    if (e?.name !== "AbortError" && !ctrl.signal.aborted) mirrorError.value = String(e?.message ?? e);
  } finally {
    if (mirrorAbort === ctrl) mirrorBusy.value = false;
  }
}

async function loadOtherPsm(o: Record<string, any>): Promise<MirrorSpectrum> {
  const row = await psmPeaks(props.psm, String(rec.value?.peptidoform ?? props.target.peptidoform), o);
  if (!row || !Array.isArray(row.mz_array) || !row.mz_array.length) throw new Error("That PSM has no stored peaks.");
  const z = Number(row.charge ?? charge.value) || 2;
  const ionsO = fragmentIons(parsed.value, Math.max(1, Math.min(2, z - 1)), true);
  const pk = annotatePeaks((row.mz_array as number[]).map(Number), ((row.intensity_array ?? []) as number[]).map(Number), ionsO, tol.value);
  return { peaks: pk, label: `PSM · ${psmLabel(o)}` };
}

watch(mirrorMode, (m) => {
  if (m === "predicted") koinaModel.value = pickKoinaModel(parsed.value).id;
  if (m === "usi" && !usiInput.value) usiInput.value = usi.value;
  loadMirror();
});
watch([koinaModel, otherIdx], () => {
  if (mirrorMode.value === "predicted" || mirrorMode.value === "psm") loadMirror();
});
// Debounced: typing a tolerance must not refetch the USI on every keystroke.
let tolTimer = 0;
watch(tol, () => {
  if (mirrorMode.value !== "psm" && mirrorMode.value !== "usi") return;
  window.clearTimeout(tolTimer);
  tolTimer = window.setTimeout(loadMirror, 600);
});
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

// Cleavage marks for the coverage map: after residue k (1-based), b_k and y_(n-k).
const coverage = computed(() => {
  const n = parsed.value.residues.length;
  const bSeen = new Set<number>();
  const ySeen = new Set<number>();
  for (const p of peaks.value) {
    if (!p.ion || p.ion.loss) continue;
    (p.ion.type === "b" ? bSeen : ySeen).add(p.ion.num);
  }
  return parsed.value.residues.map((aa, k) => ({
    aa,
    mod: parsed.value.mods[k] !== 0 || (k === 0 && parsed.value.nterm !== 0),
    b: k < n - 1 && bSeen.has(k + 1),
    y: k < n - 1 && ySeen.has(n - k - 1),
  }));
});

// Fragment ion table (USI viewer / Lorikeet style).
const tableCharges = computed(() => {
  const zs = new Set<number>();
  for (const i of ions.value) if (!i.loss) zs.add(i.charge);
  return [...zs].sort((a, b) => a - b).slice(0, 3);
});
const ionTable = computed(() => {
  const n = parsed.value.residues.length;
  const lookup = new Map(ions.value.filter((i) => !i.loss).map((i) => [ionKey(i.type, i.num, "", i.charge), i.mz]));
  return parsed.value.residues.map((aa, k) => {
    const bNum = k + 1;
    const yNum = n - k;
    return {
      bNum,
      yNum,
      aa,
      mod: parsed.value.modNames[k].join(", "),
      b: tableCharges.value.map((z) => (bNum < n ? { mz: lookup.get(ionKey("b", bNum, "", z)), hit: matchedKeys.value.has(ionKey("b", bNum, "", z)) } : null)),
      y: tableCharges.value.map((z) => (yNum < n ? { mz: lookup.get(ionKey("y", yNum, "", z)), hit: matchedKeys.value.has(ionKey("y", yNum, "", z)) } : null)),
    };
  });
});

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

        <div class="controls mirror-row">
          <label title="Draw a reference spectrum mirrored below the PSM">
            Mirror
            <select v-model="mirrorMode">
              <option value="none">none</option>
              <option value="psm">another PSM of this peptidoform</option>
              <option value="predicted">predicted (Koina)</option>
              <option value="usi">spectrum by USI</option>
              <option value="theoretical">theoretical b/y ions</option>
            </select>
          </label>
          <template v-if="mirrorMode === 'psm'">
            <select v-model.number="otherIdx" class="wide" :disabled="!otherPsms.length">
              <option v-if="!otherPsms.length" :value="-1">{{ mirrorBusy ? "searching…" : "no other PSM" }}</option>
              <option v-for="(o, k) in otherPsms.slice(0, 200)" :key="k" :value="k">{{ psmLabel(o) }}</option>
            </select>
            <span v-if="otherPsms.length" class="muted">{{ otherPsms.length > 200 ? "200+" : otherPsms.length }} other PSMs</span>
          </template>
          <template v-else-if="mirrorMode === 'predicted'">
            <select v-model="koinaModel" title="Prediction model served by Koina (koina.wilhelmlab.org)">
              <option v-for="m in KOINA_MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <label v-if="KOINA_MODELS.find((m) => m.id === koinaModel)?.ce">NCE
              <input v-model.number="nce" type="number" min="10" max="50" class="num" @change="loadMirror" />
            </label>
            <span v-if="koinaWhy" class="warn">{{ koinaWhy }}</span>
            <span v-else class="muted" title="The peptide sequence is sent to koina.wilhelmlab.org">via Koina</span>
          </template>
          <template v-else-if="mirrorMode === 'usi'">
            <input v-model="usiInput" class="mono usi-in" placeholder="mzspec:PXD…:run:scan:N:PEPTIDE/2" @keyup.enter="loadMirror" />
            <button class="xs" :disabled="mirrorBusy" @click="loadMirror">Load</button>
          </template>
          <span v-if="mirrorBusy" class="muted"><span class="spinner"></span></span>
          <span v-if="mirrorError" class="error">⚠ {{ mirrorError }}</span>
          <span v-if="sim" class="sim" title="Cosine of square-root intensities after one-to-one peak matching; SA = normalised spectral angle">
            cosine <b>{{ sim.cosine.toFixed(3) }}</b> · SA <b>{{ sim.angle.toFixed(3) }}</b> · {{ sim.matched }} matched peaks
          </span>
        </div>

        <div class="coverage mono" title="Matched b (blue, below) and y (red, above) ions without neutral losses">
          <template v-for="(c, k) in coverage" :key="k">
            <span class="aa" :class="{ mod: c.mod }">{{ c.aa }}</span>
            <span v-if="k < coverage.length - 1" class="cut" :class="{ b: c.b, y: c.y }"></span>
          </template>
        </div>

        <div class="chartbox">
          <VChart ref="chart" :option="option" autoresize class="chart" />
        </div>

        <details class="ions" open>
          <summary>Fragment ions</summary>
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th v-for="z in tableCharges" :key="'b' + z" class="bh">b{{ z > 1 ? "+".repeat(z) : "" }}</th>
                  <th>AA</th>
                  <th v-for="z in tableCharges" :key="'y' + z" class="yh">y{{ z > 1 ? "+".repeat(z) : "" }}</th>
                  <th>#</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in ionTable" :key="r.bNum">
                  <td class="muted">{{ r.bNum }}</td>
                  <td v-for="(c, j) in r.b" :key="'b' + j" class="num" :class="{ bhit: c?.hit }">{{ c?.mz != null ? c.mz.toFixed(4) : "" }}</td>
                  <td class="aa" :title="r.mod">{{ r.aa }}<sup v-if="r.mod">•</sup></td>
                  <td v-for="(c, j) in r.y" :key="'y' + j" class="num" :class="{ yhit: c?.hit }">{{ c?.mz != null ? c.mz.toFixed(4) : "" }}</td>
                  <td class="muted">{{ r.yNum }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
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
.mirror-row .wide {
  max-width: 520px;
}
.usi-in {
  flex: 1;
  min-width: 320px;
  font-size: 11px;
}
.sim {
  margin-left: auto;
  color: var(--text-dim);
}
.sim b {
  color: var(--accent);
}
.error {
  color: var(--danger, #ef4444);
}
.coverage {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  padding: 10px 0 6px;
  font-size: 17px;
  row-gap: 14px;
}
.coverage .aa {
  padding: 0 1px;
}
.coverage .aa.mod {
  color: var(--accent);
  font-weight: 700;
}
.cut {
  position: relative;
  width: 7px;
  height: 1.5em;
}
.cut.y::before {
  content: "";
  position: absolute;
  left: 3px;
  top: -6px;
  height: calc(50% + 6px);
  width: 6px;
  border-left: 2px solid #ef4444;
  border-top: 2px solid #ef4444;
}
.cut.b::after {
  content: "";
  position: absolute;
  left: -3px;
  bottom: -6px;
  height: calc(50% + 6px);
  width: 6px;
  border-right: 2px solid #3b82f6;
  border-bottom: 2px solid #3b82f6;
}
.chartbox {
  height: 470px;
}
.chart {
  width: 100%;
  height: 100%;
}
.ions summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-dim);
}
.tablewrap {
  max-height: 280px;
  overflow: auto;
  margin-top: 6px;
}
table {
  border-collapse: collapse;
  font-size: 12px;
  margin: 0 auto;
}
th,
td {
  padding: 2px 10px;
  text-align: center;
  border-bottom: 1px solid var(--border);
}
td.num {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: right;
}
td.aa {
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
th.bh {
  color: #3b82f6;
}
th.yh {
  color: #ef4444;
}
td.bhit {
  background: rgba(59, 130, 246, 0.22);
  color: var(--text);
  font-weight: 600;
}
td.yhit {
  background: rgba(239, 68, 68, 0.22);
  color: var(--text);
  font-weight: 600;
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
