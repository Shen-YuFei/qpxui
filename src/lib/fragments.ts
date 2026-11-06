// Peptide fragment-ion calculation and peak annotation for the spectrum viewer
// (b/y ions, charges, H2O/NH3 losses), in the spirit of spectrum_utils and the
// PRIDE USI viewer.

export const PROTON = 1.007276467;
export const H2O = 18.010565;
export const NH3 = 17.026549;

const RESIDUE: Record<string, number> = {
  G: 57.021464, A: 71.037114, S: 87.032028, P: 97.052764, V: 99.068414,
  T: 101.047679, C: 103.009185, L: 113.084064, I: 113.084064, J: 113.084064,
  N: 114.042927, D: 115.026943, Q: 128.058578, K: 128.094963, E: 129.042593,
  M: 131.040485, H: 137.058912, F: 147.068414, R: 156.101111, Y: 163.06332,
  W: 186.079313, U: 150.95363, O: 237.147727,
};

// [UNIMOD id, monoisotopic delta, names…]
const MODS: [number, number, ...string[]][] = [
  [1, 42.010565, "Acetyl", "Acetylation"],
  [2, -0.984016, "Amidated", "Amidation"],
  [3, 226.077598, "Biotin"],
  [4, 57.021464, "Carbamidomethyl", "CAM", "Carbamidomethylation"],
  [5, 43.005814, "Carbamyl", "Carbamylation"],
  [6, 58.005479, "Carboxymethyl"],
  [7, 0.984016, "Deamidated", "Deamidation"],
  [21, 79.966331, "Phospho", "Phosphorylation"],
  [24, 71.037114, "Propionamide"],
  [27, -18.010565, "Glu->pyro-Glu"],
  [28, -17.026549, "Gln->pyro-Glu", "Pyro-glu", "Pyro_glu"],
  [34, 14.01565, "Methyl", "Methylation"],
  [35, 15.994915, "Oxidation", "Hydroxylation"],
  [36, 28.0313, "Dimethyl"],
  [37, 42.04695, "Trimethyl"],
  [39, 45.987721, "Methylthio"],
  [40, 79.956815, "Sulfo", "Sulfation"],
  [41, 162.052824, "Hex"],
  [43, 203.079373, "HexNAc"],
  [64, 100.016044, "Succinyl"],
  [121, 114.042927, "GlyGly", "Ubiquitination"],
  [122, 27.994915, "Formyl"],
  [188, 6.020129, "Label:13C(6)"],
  [214, 144.102063, "iTRAQ4plex"],
  [259, 8.014199, "Label:13C(6)15N(2)"],
  [267, 10.008269, "Label:13C(6)15N(4)"],
  [354, 44.985078, "Nitro"],
  [385, -17.026549, "Ammonia-loss"],
  [425, 31.989829, "Dioxidation"],
  [730, 304.20536, "iTRAQ8plex"],
  [737, 229.162932, "TMT6plex", "TMT10plex", "TMT11plex"],
  [738, 225.155833, "TMT2plex"],
  [739, 224.152478, "TMT"],
  [747, 86.000394, "Malonyl"],
  [1363, 68.026215, "Crotonyl"],
  [2016, 304.207146, "TMTpro", "TMTpro16plex"],
];

const BY_NAME = new Map<string, number>();
const BY_ID = new Map<number, number>();
for (const [id, mass, ...names] of MODS) {
  BY_ID.set(id, mass);
  for (const n of names) BY_NAME.set(n.toLowerCase(), mass);
}

/** Monoisotopic mass delta of a modification token, or null if unknown.
 * Accepts names ("Oxidation", "Oxidation (M)"), accessions ("UNIMOD:35"),
 * ProForma prefixes ("U:Oxidation") and mass shifts ("+15.9949"). */
export function modMass(token: string): number | null {
  let t = token.trim();
  if (/^[+-]\d/.test(t)) {
    const v = Number(t.replace(/#.*$/, "").trim());
    return Number.isFinite(v) ? v : null;
  }
  const acc = /^UNIMOD:(\d+)$/i.exec(t);
  if (acc) return BY_ID.get(Number(acc[1])) ?? null;
  t = t.replace(/^(U|M|Obs|Formula):/i, "").replace(/#.*$/, "");
  const direct = BY_NAME.get(t.toLowerCase());
  if (direct !== undefined) return direct;
  // "Oxidation (M)" / "Acetyl (Protein N-term)"
  const base = t.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase();
  return BY_NAME.get(base) ?? (/^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : null);
}

const ID_BY_NAME = new Map<string, number>();
for (const [id, , ...names] of MODS) for (const n of names) ID_BY_NAME.set(n.toLowerCase(), id);

/** UNIMOD id of a modification token (name, accession or mass shift), or null. */
export function modUnimodId(token: string): number | null {
  const t = token.trim();
  const acc = /^UNIMOD:(\d+)$/i.exec(t);
  if (acc) return Number(acc[1]);
  const name = t.replace(/^(U|M):/i, "").replace(/#.*$/, "");
  const id = ID_BY_NAME.get(name.toLowerCase()) ?? ID_BY_NAME.get(name.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase());
  if (id !== undefined) return id;
  const m = modMass(t);
  if (m === null) return null;
  for (const [mid, mass] of MODS) if (Math.abs(mass - m) < 0.01) return mid;
  return null;
}

export interface ParsedPeptide {
  residues: string[];
  /** Summed modification mass per residue. */
  mods: number[];
  /** Modification names per residue (for display). */
  modNames: string[][];
  nterm: number;
  cterm: number;
  ntermNames: string[];
  ctermNames: string[];
  /** Modification tokens whose mass is unknown (treated as 0). */
  unknown: string[];
}

/** Parse a ProForma / OpenMS-style peptidoform: "[Acetyl]-PEPM[Oxidation]K",
 * ".(Acetyl)PEPM(Oxidation)K.", "PEPC[UNIMOD:4]K", "PEPS[+79.97]K/2". */
export function parsePeptidoform(pf: string): ParsedPeptide {
  let s = pf.trim().replace(/\/\d+$/, "");
  // Legacy parenthetical form, unless brackets are already used.
  if (!s.includes("[")) s = s.replace(/\(([^)]*)\)/g, "[$1]");
  const out: ParsedPeptide = { residues: [], mods: [], modNames: [], nterm: 0, cterm: 0, ntermNames: [], ctermNames: [], unknown: [] };
  const add = (token: string, where: "n" | "c" | number) => {
    const m = modMass(token);
    if (m === null) out.unknown.push(token);
    const v = m ?? 0;
    if (where === "n") { out.nterm += v; out.ntermNames.push(token); }
    else if (where === "c") { out.cterm += v; out.ctermNames.push(token); }
    else { out.mods[where] += v; out.modNames[where].push(token); }
  };
  let i = 0;
  const n = s.length;
  const readBracket = (): string | null => {
    if (s[i] !== "[") return null;
    let depth = 0;
    for (let j = i; j < n; j++) {
      if (s[j] === "[") depth++;
      else if (s[j] === "]" && --depth === 0) {
        const tok = s.slice(i + 1, j);
        i = j + 1;
        return tok;
      }
    }
    i = n;
    return null;
  };
  if (s[i] === ".") i++;
  // Leading N-terminal mods: "[X]-", "[X]" (OpenMS ".[X]PEP") or "[X][Y]-".
  while (s[i] === "[") {
    const tok = readBracket();
    if (tok !== null) add(tok, "n");
    if (s[i] === "-") { i++; break; }
  }
  while (i < n) {
    const c = s[i];
    if (c === "[") {
      const tok = readBracket();
      if (tok === null) continue;
      if (out.residues.length) add(tok, out.residues.length - 1);
      else add(tok, "n");
      continue;
    }
    if (c === "{") {
      const close = s.indexOf("}", i);
      i = close < 0 ? n : close + 1;
      continue;
    }
    if (c === "-" || c === ".") {
      // C-terminal mod: "-[X]" (ProForma) or ".[X]" (OpenMS).
      i++;
      while (s[i] === "[") {
        const tok = readBracket();
        if (tok !== null) add(tok, "c");
      }
      continue;
    }
    if (/[A-Z]/.test(c)) {
      out.residues.push(c);
      out.mods.push(0);
      out.modNames.push([]);
    }
    i++;
  }
  for (const r of out.residues) if (!(r in RESIDUE)) out.unknown.push(r);
  return out;
}

/** ProForma 2.0 text (as used in USIs) for a parsed peptide. */
export function toProForma(p: ParsedPeptide): string {
  // Prefer UNIMOD accessions; drop "(site)" suffixes ProForma does not allow.
  const tok = (x: string) => {
    const id = modUnimodId(x);
    return id != null ? `UNIMOD:${id}` : x.replace(/\s*\([^)]*\)\s*$/, "");
  };
  const br = (names: string[]) => names.map((x) => `[${tok(x)}]`).join("");
  const nt = p.ntermNames.length ? `${br(p.ntermNames)}-` : "";
  const ct = p.ctermNames.length ? `-${br(p.ctermNames)}` : "";
  return nt + p.residues.map((r, k) => r + br(p.modNames[k])).join("") + ct;
}

export function neutralMass(p: ParsedPeptide): number {
  let m = H2O + p.nterm + p.cterm;
  p.residues.forEach((r, k) => (m += (RESIDUE[r] ?? 0) + p.mods[k]));
  return m;
}

export function precursorMz(p: ParsedPeptide, z: number): number {
  return (neutralMass(p) + z * PROTON) / z;
}

export type IonType = "b" | "y";
export type Loss = "" | "-H2O" | "-NH3";

export interface FragmentIon {
  type: IonType;
  /** Ion number (b3 -> 3). */
  num: number;
  charge: number;
  loss: Loss;
  mz: number;
  /** "y5-H2O++" style label. */
  label: string;
}

export function ionLabel(type: string, num: number, loss: string, charge: number): string {
  return `${type}${num}${loss}${charge > 1 ? "+".repeat(charge) : ""}`;
}

export function ionKey(type: string, num: number, loss: string, charge: number): string {
  return `${type}${num}${loss}^${charge}`;
}

/** Theoretical b/y fragment ions (b1…b(n-1), y1…y(n-1)). */
export function fragmentIons(p: ParsedPeptide, maxCharge: number, losses: boolean, anyLoss = false): FragmentIon[] {
  const n = p.residues.length;
  const res = p.residues.map((r, k) => (RESIDUE[r] ?? 0) + p.mods[k]);
  const lossList: [Loss, number][] = losses ? [["", 0], ["-H2O", H2O], ["-NH3", NH3]] : [["", 0]];
  const ions: FragmentIon[] = [];
  let b = p.nterm;
  const bNeutral: number[] = [];
  for (let k = 0; k < n - 1; k++) bNeutral.push((b += res[k]));
  let y = H2O + p.cterm;
  const yNeutral: number[] = [];
  for (let k = n - 1; k > 0; k--) yNeutral.push((y += res[k]));
  // Neutral losses only for fragments holding a residue that can lose them:
  // water from S/T/E/D, ammonia from R/K/N/Q.
  const can = (loss: Loss, seq: string[]) =>
    loss === "" || anyLoss || seq.some((r) => (loss === "-H2O" ? "STED" : "RKNQ").includes(r));
  for (let z = 1; z <= maxCharge; z++) {
    for (const [loss, lm] of lossList) {
      for (let k = 0; k < n - 1; k++) {
        const num = k + 1;
        if (can(loss, p.residues.slice(0, num)))
          ions.push({ type: "b", num, charge: z, loss, mz: (bNeutral[k] - lm + z * PROTON) / z, label: ionLabel("b", num, loss, z) });
        if (can(loss, p.residues.slice(n - num)))
          ions.push({ type: "y", num, charge: z, loss, mz: (yNeutral[k] - lm + z * PROTON) / z, label: ionLabel("y", num, loss, z) });
      }
    }
  }
  return ions;
}

export interface Tolerance {
  value: number;
  unit: "ppm" | "Da";
}

function within(obs: number, theo: number, tol: Tolerance): boolean {
  const d = Math.abs(obs - theo);
  return tol.unit === "Da" ? d <= tol.value : (d / theo) * 1e6 <= tol.value;
}

export interface Peak {
  mz: number;
  intensity: number;
  /** Matched ion, if any. */
  ion?: FragmentIon;
  /** Observed - theoretical, in the tolerance unit. */
  error?: number;
}

/** Annotate each peak with the closest theoretical ion within tolerance
 * (ties prefer ions without neutral losses, then lower charge). */
export function annotatePeaks(mz: number[], intensity: number[], ions: FragmentIon[], tol: Tolerance): Peak[] {
  const sorted = [...ions].sort((a, b) => a.mz - b.mz);
  const lo = (x: number) => {
    let a = 0, b = sorted.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (sorted[m].mz < x) a = m + 1;
      else b = m;
    }
    return a;
  };
  return mz.map((m, i) => {
    const pk: Peak = { mz: m, intensity: intensity[i] ?? 0 };
    const window = tol.unit === "Da" ? tol.value : (m * tol.value) / 1e6;
    let best: FragmentIon | undefined;
    let bestScore = Infinity;
    for (let k = lo(m - window * 1.01); k < sorted.length && sorted[k].mz <= m + window * 1.01; k++) {
      const ion = sorted[k];
      if (!within(m, ion.mz, tol)) continue;
      const score = Math.abs(m - ion.mz) + (ion.loss ? 1e-6 : 0) + ion.charge * 1e-7;
      if (score < bestScore) {
        bestScore = score;
        best = ion;
      }
    }
    if (best) {
      pk.ion = best;
      pk.error = errorIn(m, best.mz, tol.unit);
    }
    return pk;
  });
}

export function errorIn(obs: number, theo: number, unit: Tolerance["unit"]): number {
  return unit === "Da" ? obs - theo : ((obs - theo) / theo) * 1e6;
}

/** Use annotations stored in the file (spectrum_utils labels such as "y5-H2O"
 * with a separate charge array), resolving their theoretical m/z for errors. */
export function storedAnnotations(
  mz: number[],
  intensity: number[],
  labels: (string | null)[],
  charges: (number | null)[],
  ions: FragmentIon[],
  unit: Tolerance["unit"]
): Peak[] {
  const byKey = new Map(ions.map((x) => [ionKey(x.type, x.num, x.loss, x.charge), x]));
  return mz.map((m, i) => {
    const pk: Peak = { mz: m, intensity: intensity[i] ?? 0 };
    const lab = labels[i];
    const g = lab ? /^([by])(\d+)(-H2O|-NH3)?/.exec(lab) : null;
    if (g) {
      const z = Number(charges[i] ?? 1) || 1;
      const known = byKey.get(ionKey(g[1], Number(g[2]), g[3] ?? "", z));
      pk.ion = known ?? {
        type: g[1] as IonType, num: Number(g[2]), charge: z, loss: (g[3] ?? "") as Loss, mz: NaN,
        label: ionLabel(g[1], Number(g[2]), g[3] ?? "", z),
      };
      if (known) pk.error = errorIn(m, known.mz, unit);
    }
    return pk;
  });
}
