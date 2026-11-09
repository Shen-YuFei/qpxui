// The spectrum viewer's mirror: a reference spectrum drawn below the PSM
// (another PSM of the peptidoform, a Koina prediction, a spectrum by USI or
// the theoretical b/y ladder) and its similarity to the PSM.
import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { annotatePeaks, fragmentIons, type ParsedPeptide, type Peak, type Tolerance } from "./fragments";
import { KOINA_MODELS, fetchUsi, koinaPredict, koinaSequence, pickKoinaModel, similarity, theoretical, type MirrorSpectrum } from "./mirror";
import { peptidoformPsms, psmLabel, psmPeaks, type PsmKey } from "./queries/spectrum";
import type { TableRef } from "./report";

export type MirrorMode = "none" | "psm" | "theoretical" | "predicted" | "usi";

/** What the mirror reads from the viewer. */
export interface MirrorContext {
  psm: () => TableRef;
  /** The PSM the viewer was opened for. */
  target: () => PsmKey;
  /** Its row once read; null before. */
  rec: Ref<Record<string, any> | null>;
  parsed: ComputedRef<ParsedPeptide>;
  charge: ComputedRef<number>;
  scan: ComputedRef<any>;
  tol: ComputedRef<Tolerance>;
  tolUnit: Ref<Tolerance["unit"]>;
  source: Ref<"file" | "computed">;
  peaks: ComputedRef<Peak[]>;
  usi: ComputedRef<string>;
}

export function useMirror(c: MirrorContext) {
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

  const peptidoform = () => String(c.rec.value?.peptidoform ?? c.target().peptidoform);

  const koinaWhy = computed(() => {
    const m = KOINA_MODELS.find((x) => x.id === koinaModel.value)!;
    return koinaSequence(c.parsed.value, m).why ?? "";
  });

  /** Similarity between the PSM and the mirror (not for the theoretical ladder,
   * whose intensities are arbitrary). */
  const sim = computed(() => {
    if (!mirror.value || mirrorMode.value === "theoretical" || !c.peaks.value.length) return null;
    const t: Tolerance = c.source.value === "file" ? { value: c.tolUnit.value === "Da" ? 0.02 : 20, unit: c.tolUnit.value } : c.tol.value;
    return similarity(c.peaks.value, mirror.value.peaks, t);
  });

  async function listOtherPsms() {
    const r = await peptidoformPsms(c.psm(), peptidoform());
    const curScan = c.scan.value;
    const curRun = c.rec.value?.run_file_name ?? c.target().run_file_name;
    otherPsms.value = r.filter((x) => {
      const sc = Array.isArray(x.scan) ? x.scan[0] : x.scan;
      return !(sc == curScan && (x.run_file_name ?? null) == (curRun ?? null) && (x.charge == null || x.charge == c.charge.value));
    });
  }

  async function loadMirror() {
    mirrorAbort?.abort();
    mirror.value = null;
    mirrorError.value = "";
    if (mirrorMode.value === "none" || !c.rec.value) return;
    const ctrl = (mirrorAbort = new AbortController());
    mirrorBusy.value = true;
    try {
      let out: MirrorSpectrum | null = null;
      if (mirrorMode.value === "theoretical") {
        out = theoretical(c.parsed.value, Math.max(1, Math.min(2, c.charge.value - 1)));
      } else if (mirrorMode.value === "predicted") {
        const m = KOINA_MODELS.find((x) => x.id === koinaModel.value)!;
        if (koinaWhy.value) return;
        out = await koinaPredict(c.parsed.value, c.charge.value, m, Number(nce.value) || 27, ctrl.signal);
      } else if (mirrorMode.value === "usi") {
        if (!usiInput.value.trim()) return;
        out = await fetchUsi(usiInput.value, c.tol.value, { parsed: c.parsed.value, charge: c.charge.value }, ctrl.signal);
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
    const row = await psmPeaks(c.psm(), peptidoform(), o);
    if (!row || !Array.isArray(row.mz_array) || !row.mz_array.length) throw new Error("That PSM has no stored peaks.");
    const z = Number(row.charge ?? c.charge.value) || 2;
    const ionsO = fragmentIons(c.parsed.value, Math.max(1, Math.min(2, z - 1)), true);
    const pk = annotatePeaks((row.mz_array as number[]).map(Number), ((row.intensity_array ?? []) as number[]).map(Number), ionsO, c.tol.value);
    return { peaks: pk, label: `PSM · ${psmLabel(o)}` };
  }

  watch(mirrorMode, (m) => {
    if (m === "predicted") koinaModel.value = pickKoinaModel(c.parsed.value).id;
    if (m === "usi" && !usiInput.value) usiInput.value = c.usi.value;
    loadMirror();
  });
  watch([koinaModel, otherIdx], () => {
    if (mirrorMode.value === "predicted" || mirrorMode.value === "psm") loadMirror();
  });
  // Debounced: typing a tolerance must not refetch the USI on every keystroke.
  let tolTimer = 0;
  watch(c.tol, () => {
    if (mirrorMode.value !== "psm" && mirrorMode.value !== "usi") return;
    window.clearTimeout(tolTimer);
    tolTimer = window.setTimeout(loadMirror, 600);
  });

  return { mirrorMode, mirror, mirrorBusy, mirrorError, otherPsms, otherIdx, koinaModel, nce, usiInput, koinaWhy, sim, loadMirror };
}
