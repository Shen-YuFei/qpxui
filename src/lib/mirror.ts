// Reference spectra for the mirror plot: predicted (Koina), remote (USI via
// PROXI) and theoretical, plus a spectral similarity score.
import {
  annotatePeaks,
  fragmentIons,
  ionLabel,
  modUnimodId,
  parsePeptidoform,
  type FragmentIon,
  type IonType,
  type ParsedPeptide,
  type Peak,
  type Tolerance,
} from "./fragments";

export interface MirrorSpectrum {
  peaks: Peak[];
  /** Short legend text, e.g. "Prosit 2020 HCD (NCE 27)". */
  label: string;
}

// ---------------------------------------------------------------- Koina

export interface KoinaModel {
  id: string;
  label: string;
  /** Needs a collision energy input. */
  ce: boolean;
  /** Needs an instrument type input. */
  instrument?: boolean;
  /** UNIMOD ids the model accepts (per residue; "n" for N-term). */
  mods: { residue: Record<string, number[]>; nterm: number[] };
  maxLen: number;
}

export const KOINA_MODELS: KoinaModel[] = [
  {
    id: "Prosit_2020_intensity_HCD",
    label: "Prosit 2020 HCD",
    ce: true,
    mods: { residue: { C: [4], M: [35] }, nterm: [] },
    maxLen: 30,
  },
  {
    id: "AlphaPeptDeep_ms2_generic",
    label: "AlphaPeptDeep",
    ce: true,
    instrument: true,
    mods: { residue: { C: [4], M: [35], S: [21], T: [21], Y: [21], K: [1, 121], N: [7], Q: [7] }, nterm: [1] },
    maxLen: 50,
  },
  {
    id: "ms2pip_HCD2021",
    label: "MS²PIP HCD 2021",
    ce: false,
    mods: { residue: { C: [4], M: [35], S: [21], T: [21], Y: [21], N: [7], Q: [7] }, nterm: [1] },
    maxLen: 30,
  },
];

const KOINA_URL = "https://koina.wilhelmlab.org/v2/models";

/** ProForma with UNIMOD accessions for a model, or a reason it cannot be predicted. */
export function koinaSequence(p: ParsedPeptide, model: KoinaModel): { seq?: string; why?: string } {
  if (p.residues.length > model.maxLen) return { why: `${model.label} supports peptides up to ${model.maxLen} residues` };
  if (p.cterm !== 0) return { why: `${model.label} does not support C-terminal modifications` };
  const ids = (names: string[]) => names.map((n) => [n, modUnimodId(n)] as const);
  let nt = "";
  for (const [name, id] of ids(p.ntermNames)) {
    if (id == null || !model.mods.nterm.includes(id)) return { why: `${model.label} does not support N-terminal ${name}` };
    nt += `[UNIMOD:${id}]`;
  }
  let body = "";
  for (let k = 0; k < p.residues.length; k++) {
    const aa = p.residues[k];
    body += aa;
    for (const [name, id] of ids(p.modNames[k])) {
      if (id == null || !(model.mods.residue[aa] ?? []).includes(id)) return { why: `${model.label} does not support ${name} on ${aa}` };
      body += `[UNIMOD:${id}]`;
    }
  }
  return { seq: nt ? `${nt}-${body}` : body };
}

/** First model that can predict this peptidoform. */
export function pickKoinaModel(p: ParsedPeptide): KoinaModel {
  return KOINA_MODELS.find((m) => koinaSequence(p, m).seq) ?? KOINA_MODELS[0];
}

function parseIonLabel(s: string): FragmentIon | null {
  const g = /^([by])(\d+)\+(\d+)$/.exec(s);
  if (!g) return null;
  const [type, num, z] = [g[1] as IonType, Number(g[2]), Number(g[3])];
  return { type, num, charge: z, loss: "", mz: NaN, label: ionLabel(type, num, "", z) };
}

export async function koinaPredict(
  p: ParsedPeptide,
  charge: number,
  model: KoinaModel,
  nce: number,
  signal?: AbortSignal
): Promise<MirrorSpectrum> {
  const { seq, why } = koinaSequence(p, model);
  if (!seq) throw new Error(why);
  const inputs: any[] = [
    { name: "peptide_sequences", shape: [1, 1], datatype: "BYTES", data: [seq] },
    { name: "precursor_charges", shape: [1, 1], datatype: "INT32", data: [Math.min(Math.max(charge, 1), 6)] },
  ];
  if (model.ce) inputs.push({ name: "collision_energies", shape: [1, 1], datatype: "FP32", data: [nce] });
  if (model.instrument) inputs.push({ name: "instrument_types", shape: [1, 1], datatype: "BYTES", data: ["QE"] });
  const res = await fetch(`${KOINA_URL}/${model.id}/infer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "0", inputs }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Koina: ${String(body.error ?? res.statusText).split("\n")[0]}`);
  const out = Object.fromEntries((body.outputs ?? []).map((o: any) => [o.name, o.data]));
  const mz: number[] = out.mz ?? [];
  const inten: number[] = out.intensities ?? [];
  const ann: string[] = out.annotation ?? [];
  const top = Math.max(0, ...inten);
  const peaks: Peak[] = [];
  for (let i = 0; i < mz.length; i++) {
    // -1 marks impossible ions; drop near-zero predictions.
    if (!(mz[i] > 0) || !(inten[i] > top * 0.005)) continue;
    const ion = parseIonLabel(String(ann[i] ?? ""));
    if (ion) ion.mz = mz[i];
    peaks.push({ mz: mz[i], intensity: inten[i], ion: ion ?? undefined });
  }
  if (!peaks.length) throw new Error("Koina returned no fragment intensities.");
  peaks.sort((a, b) => a.mz - b.mz);
  return { peaks, label: `${model.label}${model.ce ? ` · NCE ${nce}` : ""}` };
}

// ---------------------------------------------------------------- USI

const PROXI = [
  "https://www.ebi.ac.uk/pride/proxi/archive/v0.1/spectra",
  "https://proteomecentral.proteomexchange.org/api/proxi/v0.1/spectra",
];

/** Peptidoform and charge interpretation at the end of a USI, if present. */
export function usiInterpretation(usi: string): { peptidoform: string; charge: number } | null {
  const m = /:([^:]+)\/(\d+)$/.exec(usi.trim());
  return m ? { peptidoform: m[1], charge: Number(m[2]) } : null;
}

export async function fetchUsi(
  usi: string,
  tol: Tolerance,
  fallback: { parsed: ParsedPeptide; charge: number },
  signal?: AbortSignal
): Promise<MirrorSpectrum> {
  const errs: string[] = [];
  for (const base of PROXI) {
    try {
      const res = await fetch(`${base}?resultType=full&usi=${encodeURIComponent(usi.trim())}`, { signal });
      const body = await res.json().catch(() => null);
      const sp = Array.isArray(body) ? body[0] : null;
      if (!res.ok || !sp?.mzs?.length) {
        errs.push(`${new URL(base).host}: ${body?.title ?? body?.detail ?? res.statusText ?? "no spectrum"}`);
        continue;
      }
      const mz = (sp.mzs as unknown[]).map(Number);
      const inten = (sp.intensities as unknown[]).map(Number);
      const interp = usiInterpretation(usi);
      const parsed = interp ? parsePeptidoform(interp.peptidoform) : fallback.parsed;
      const z = interp?.charge ?? fallback.charge;
      const ions = fragmentIons(parsed, Math.max(1, Math.min(2, z - 1)), true);
      return { peaks: annotatePeaks(mz, inten, ions, tol), label: `USI · ${new URL(base).host}` };
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      errs.push(`${new URL(base).host}: ${e?.message ?? e}`);
    }
  }
  throw new Error(`Spectrum not found. ${errs.join(" · ")}`);
}

// ---------------------------------------------------------------- theoretical

export function theoretical(p: ParsedPeptide, maxCharge: number): MirrorSpectrum {
  const ions = fragmentIons(p, maxCharge, false);
  return {
    peaks: ions.map((ion) => ({ mz: ion.mz, intensity: ion.charge === 1 ? 100 : 60, ion })).sort((a, b) => a.mz - b.mz),
    label: `Theoretical b/y (z ≤ ${maxCharge})`,
  };
}

// ---------------------------------------------------------------- similarity

/**
 * Cosine similarity of two spectra after greedy one-to-one peak matching
 * within the tolerance (most intense pairs first), plus the normalised
 * spectral angle (1 = identical, 0 = orthogonal). Intensities are
 * square-root transformed, as is usual for spectrum comparison.
 */
export function similarity(a: Peak[], b: Peak[], tol: Tolerance): { cosine: number; angle: number; matched: number } {
  const A = a.map((p) => ({ mz: p.mz, w: Math.sqrt(Math.max(p.intensity, 0)) }));
  const B = b.map((p) => ({ mz: p.mz, w: Math.sqrt(Math.max(p.intensity, 0)) }));
  const na = Math.hypot(...A.map((x) => x.w));
  const nb = Math.hypot(...B.map((x) => x.w));
  if (!na || !nb) return { cosine: 0, angle: 0, matched: 0 };
  const pairs: [number, number, number][] = [];
  const sortedB = B.map((x, j) => ({ ...x, j })).sort((x, y) => x.mz - y.mz);
  for (let i = 0; i < A.length; i++) {
    const m = A[i].mz;
    const win = tol.unit === "Da" ? tol.value : (m * tol.value) / 1e6;
    let lo = 0, hi = sortedB.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedB[mid].mz < m - win) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < sortedB.length && sortedB[k].mz <= m + win; k++) pairs.push([A[i].w * sortedB[k].w, i, sortedB[k].j]);
  }
  pairs.sort((x, y) => y[0] - x[0]);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let dot = 0;
  for (const [s, i, j] of pairs) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i);
    usedB.add(j);
    dot += s;
  }
  const cosine = Math.min(1, dot / (na * nb));
  return { cosine, angle: 1 - (2 * Math.acos(cosine)) / Math.PI, matched: usedA.size };
}
