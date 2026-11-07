// Summaries of an annotated spectrum for the viewer: the annotation counts,
// the sequence coverage map and the fragment ion table.
import { ionKey, type FragmentIon, type ParsedPeptide, type Peak } from "./fragments";

/** Annotation summary of a spectrum: peaks, annotated peaks, the annotated
 * share of the total ion current, distinct b and y ion numbers, and the
 * backbone cleavages (of n - 1) that a b or complementary y ion explains. */
export interface SpectrumStats {
  peaks: number;
  annotated: number;
  ticPct: number;
  b: number;
  y: number;
  cleav: number;
  n: number;
}

export function spectrumStats(p: ParsedPeptide, peaks: Peak[]): SpectrumStats {
  const n = p.residues.length;
  const tic = peaks.reduce((a, x) => a + x.intensity, 0) || 1;
  const ann = peaks.filter((x) => x.ion);
  const bNums = new Set(ann.filter((x) => x.ion!.type === "b").map((x) => x.ion!.num));
  const yNums = new Set(ann.filter((x) => x.ion!.type === "y").map((x) => x.ion!.num));
  // A backbone cleavage is explained if either the b or the complementary y ion is seen.
  let cleav = 0;
  for (let k = 1; k < n; k++) if (bNums.has(k) || yNums.has(n - k)) cleav++;
  return {
    peaks: peaks.length,
    annotated: ann.length,
    ticPct: (ann.reduce((a, x) => a + x.intensity, 0) / tic) * 100,
    b: bNums.size,
    y: yNums.size,
    cleav,
    n,
  };
}

/** One residue of the coverage map and the cleavage after it: `b` when the
 * b ion ending at the residue matched, `y` when the y ion starting after it
 * did (ions without neutral losses). */
export interface CoverageMark {
  aa: string;
  mod: boolean;
  b: boolean;
  y: boolean;
}

export function coverageMarks(p: ParsedPeptide, peaks: Peak[]): CoverageMark[] {
  const n = p.residues.length;
  const bSeen = new Set<number>();
  const ySeen = new Set<number>();
  for (const x of peaks) {
    if (!x.ion || x.ion.loss) continue;
    (x.ion.type === "b" ? bSeen : ySeen).add(x.ion.num);
  }
  return p.residues.map((aa, k) => ({
    aa,
    mod: p.mods[k] !== 0 || (k === 0 && p.nterm !== 0),
    b: k < n - 1 && bSeen.has(k + 1),
    y: k < n - 1 && ySeen.has(n - k - 1),
  }));
}

/** ionKey of every ion a peak matched. */
export function matchedIonKeys(peaks: Peak[]): Set<string> {
  const s = new Set<string>();
  for (const p of peaks) if (p.ion) s.add(ionKey(p.ion.type, p.ion.num, p.ion.loss, p.ion.charge));
  return s;
}

/** Fragment charges the ion table shows: the lowest three of the ions
 * without neutral losses. */
export function ionTableCharges(ions: FragmentIon[]): number[] {
  const zs = new Set<number>();
  for (const i of ions) if (!i.loss) zs.add(i.charge);
  return [...zs].sort((a, b) => a - b).slice(0, 3);
}

/** An ion table cell: the ion's m/z and whether a peak matched it. */
export interface IonCell {
  mz: number | undefined;
  hit: boolean;
}

/** An ion table row: the residue, the b ion ending at it and the y ion
 * starting at it, at each charge (null past the last cleavage). */
export interface IonRow {
  bNum: number;
  yNum: number;
  aa: string;
  mod: string;
  b: (IonCell | null)[];
  y: (IonCell | null)[];
}

/** The fragment ion table (USI viewer / Lorikeet style); `matched` holds
 * the ionKey of each matched ion. */
export function ionTableRows(p: ParsedPeptide, ions: FragmentIon[], matched: Set<string>, charges: number[]): IonRow[] {
  const n = p.residues.length;
  const lookup = new Map(ions.filter((i) => !i.loss).map((i) => [ionKey(i.type, i.num, "", i.charge), i.mz]));
  return p.residues.map((aa, k) => {
    const bNum = k + 1;
    const yNum = n - k;
    return {
      bNum,
      yNum,
      aa,
      mod: p.modNames[k].join(", "),
      b: charges.map((z) => (bNum < n ? { mz: lookup.get(ionKey("b", bNum, "", z)), hit: matched.has(ionKey("b", bNum, "", z)) } : null)),
      y: charges.map((z) => (yNum < n ? { mz: lookup.get(ionKey("y", yNum, "", z)), hit: matched.has(ionKey("y", yNum, "", z)) } : null)),
    };
  });
}
