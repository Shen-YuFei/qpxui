// PTM-aware rendering helpers for the QPX portal viewer.
//
// Peptide-level views (PSM, Feature, Peptide) expose modifications in two
// complementary ways:
//   * `peptidoform`  VARCHAR   ProForma notation, e.g.
//                      "PEPTS[Phospho]DM[Oxidation]K"
//                      "[Acetyl]-VLHPLEGAVVIIFK"
//                      "PEPT[UNIMOD:21]IDM[UNIMOD:35]K"
//                      "PEK[+42.011]TIDE"  (mass shift)
//                      "[TMT6plex]-PEPTIDM[Oxidation]K[TMT6plex]"
//   * `modifications` STRUCT[] e.g. [{name:"Phospho", accession:"UNIMOD:21",
//                      positions:[{position:5, amino_acid:"S", scores:[...]}]}]
//
// We turn either (or both) into a flat list of renderable tokens so the UI can
// colour the modified residue, add a superscript short code and show a tooltip
// with the full modification name, mass delta and position — matching the
// portal's colour-coded residue + short-notation style.

import { resolvePtmColor } from "./settings";

export interface PTMSeg {
  /** Residue text: a plain amino acid, a run of plain residues, or a modified AA. */
  text: string;
  modified: boolean;
  /** Full modification name (e.g. "Phospho", "Oxidation"). */
  modName?: string;
  /** CV accession when known (e.g. "UNIMOD:21"). */
  accession?: string;
  /** 0-based residue index of this token's first residue (-1 for N-terminal). */
  pos?: number;
  /** 1-based residue position of the modified residue (0 = N-terminus, n+1 = C-terminus). */
  modPos?: number;
  aa?: string;
  /** Terminal-label attachments: "N" (N-terminus) or "C" (C-terminus). */
  terminal?: "N" | "C";
}

/**
 * Curated context for a modification: its canonical (Unimod / PSI-MOD) accession
 * and its monoisotopic delta mass in Da. Keyed by tested name variants.
 * Source: Unimod (unimod.org) single-residue monoisotopic delta masses.
 */
export interface PTMMeta {
  name: string;
  accession: string;
  mass: number; // monoisotopic delta mass (Da)
  code: string;
}

export const PTM_META: Record<string, PTMMeta> = {
  phospho: { name: "Phospho", accession: "UNIMOD:21", mass: 79.966331, code: "P" },
  phosphorylation: { name: "Phosphorylation", accession: "UNIMOD:21", mass: 79.966331, code: "P" },
  oxidation: { name: "Oxidation", accession: "UNIMOD:35", mass: 15.994915, code: "Ox" },
  oxidized_methionine: { name: "Oxidation", accession: "UNIMOD:35", mass: 15.994915, code: "Ox" },
  oxidation_or_hydroxylation: { name: "Oxidation or Hydroxylation", accession: "UNIMOD:35", mass: 15.994915, code: "Ox" },
  acetyl: { name: "Acetyl", accession: "UNIMOD:1", mass: 42.010565, code: "Ac" },
  acetylation: { name: "Acetylation", accession: "UNIMOD:1", mass: 42.010565, code: "Ac" },
  carbamidomethyl: { name: "Carbamidomethyl", accession: "UNIMOD:4", mass: 57.021464, code: "Cm" },
  carbamidomethylation: { name: "Carbamidomethyl", accession: "UNIMOD:4", mass: 57.021464, code: "Cm" },
  carbamyl: { name: "Carbamyl", accession: "UNIMOD:5", mass: 43.005814, code: "Cb" },
  carbamylation: { name: "Carbamyl", accession: "UNIMOD:5", mass: 43.005814, code: "Cb" },
  deamidated: { name: "Deamidated", accession: "UNIMOD:7", mass: 0.984016, code: "Dn" },
  deamidation: { name: "Deamidated", accession: "UNIMOD:7", mass: 0.984016, code: "Dn" },
  glygly: { name: "GlyGly", accession: "UNIMOD:121", mass: 114.042927, code: "G" },
  gg: { name: "GlyGly", accession: "UNIMOD:121", mass: 114.042927, code: "G" },
  ubiquitination: { name: "Ubiquitination", accession: "UNIMOD:121", mass: 114.042927, code: "Ub" },
  methyl: { name: "Methyl", accession: "UNIMOD:34", mass: 14.01565, code: "Me" },
  methylation: { name: "Methyl", accession: "UNIMOD:34", mass: 14.01565, code: "Me" },
  dimethyl: { name: "Dimethyl", accession: "UNIMOD:36", mass: 28.0313, code: "DiMe" },
  dimethylation: { name: "Dimethyl", accession: "UNIMOD:36", mass: 28.0313, code: "DiMe" },
  trimethyl: { name: "Trimethyl", accession: "UNIMOD:37", mass: 42.04695, code: "TriMe" },
  trimethylation: { name: "Trimethyl", accession: "UNIMOD:37", mass: 42.04695, code: "TriMe" },
  guanidinyl: { name: "Guanidinyl", accession: "UNIMOD:52", mass: 42.021798, code: "Gu" },
  guanidination: { name: "Guanidinyl", accession: "UNIMOD:52", mass: 42.021798, code: "Gu" },
  sulfation: { name: "Sulfation", accession: "UNIMOD:40", mass: 79.956815, code: "SO3" },
  sulfo: { name: "Sulfation", accession: "UNIMOD:40", mass: 79.956815, code: "SO3" },
  oxidation_orhydroxylation: { name: "Oxidation or Hydroxylation", accession: "UNIMOD:35", mass: 15.994915, code: "Ox" },
  dethiomethyl: { name: "Dethiomethyl", accession: "UNIMOD:526", mass: -48.003371, code: "dM" },
  carbamidomethylation_d: { name: "Carbamidomethyl (D)", accession: "UNIMOD:4", mass: 57.021464, code: "Cm" },
};

/** Normalize a modification name for CV lookup ("Oxidation (M)" -> "oxidation_m"). */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Look up a modification's context by name (or canonical accession). */
export function ptmMeta(name?: string, accession?: string): PTMMeta | null {
  if (accession) {
    const acc = accession.toUpperCase();
    const hit = Object.values(PTM_META).find((m) => m.accession === acc);
    if (hit) return hit;
  }
  if (!name) return null;
  return PTM_META[normalizeName(name)] ?? null;
}

/** Column names that carry a peptide sequence (as opposed to numeric peptide stats). */
const PEPTIDE_COL = /peptidoform|modified_?sequence|peptide_?sequence|^sequence$|^peptide$/;

export function isPeptideCol(col: string): boolean {
  return PEPTIDE_COL.test(col.trim().toLowerCase());
}

export function isModificationsCol(col: string): boolean {
  return col.trim().toLowerCase() === "modifications";
}

/**
 * Resolve a single inline modification token (the text inside brackets) to a
 * display name and, when possible, a canonical accession. Understands common
 * names ("Phospho"), Unimod accessions ("UNIMOD:21"), CHEMMOD mass shifts
 * ("CHEMMOD:+15.9949" / "+79.9663") and labels (TMT/iTRAQ).
 */
export function resolveModToken(content: string): {
  name: string;
  accession?: string;
  mass?: string;
} {
  let s = content.trim();
  if (!s) return { name: content };
  // CHEMMOD mass-shift prefix.
  if (/^CHEMMOD:/i.test(s)) s = s.replace(/^CHEMMOD:/i, "");
  // Pure signed mass delta, e.g. "+79.9663", "-17.027".
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
    return { name: s, mass: s };
  }
  // Ontology accession, e.g. UNIMOD:21 / UniMod:21 / MOD:xxxxx.
  if (/^UNIMOD:\d+$/i.test(s)) {
    const acc = s.toUpperCase();
    const meta = ptmMeta(undefined, acc);
    return { name: meta?.name ?? s, accession: acc };
  }
  // Known common name.
  const meta = ptmMeta(s);
  if (meta) return { name: meta.name, accession: meta.accession };
  // Label (SILAC) or unknown tagged form — keep as-is.
  return { name: s };
}

/**
 * Parse the inline ProForma peptidoform string into renderable segments.
 * Handles residue-attached mods ("S[Phospho]"), N-terminal mods ("[Acetyl]-"),
 * C-terminal labels ("...K[TMT6plex]"), accessions ("[UNIMOD:21]") and mass
 * shifts ("[+79.9663]"). Also tolerates the plain parenthetical form
 * ("S(Phospho)") for datasets that emit that variant.
 */
export function inlineToSegments(s: string): PTMSeg[] {
  // Normalise the parenthetical legacy form to ProForma brackets.
  const norm = s.replace(/\(([^)]*)\)/g, "[$1]");
  const segs: PTMSeg[] = [];
  let i = 0;
  const n = norm.length;
  let pos = 0; // 0-based residue index

  // ---- Leading terminal (N-terminus) modifications: [Mod]- / [Mod][Mod]- ----
  while (i < n) {
    const c = norm[i];
    if (c !== "[") break; // only bracket-prefixed terminals can appear up front
    const close = norm.indexOf("]", i);
    if (close === -1) break;
    const r = resolveModToken(norm.slice(i + 1, close));
    // "[Mod]-" is ProForma's N-terminal form; a leading bracket without the
    // dash (rare) is shown the same way.
    i = norm[close + 1] === "-" ? close + 2 : close + 1;
    segs.push({
      text: "",
      modified: true,
      terminal: "N",
      modName: r.name,
      accession: r.accession,
      modPos: 0,
      pos: -1,
    });
  }

  // ---- Sequence body with residue-attached mods ----
  while (i < n) {
    const c = norm[i];
    if (c === "[") {
      const close = norm.indexOf("]", i);
      if (close === -1) {
        i++;
        continue;
      }
      const content = norm.slice(i + 1, close);
      const r = resolveModToken(content);
      const last = segs[segs.length - 1];
      if (last && !last.terminal) {
        // Attach to the residue most recently emitted (may already carry a mod).
        last.modified = true;
        last.modName = r.name;
        last.accession = r.accession;
        if (last.modPos === undefined) last.modPos = (last.pos ?? 0) + 1;
      } else if (last && last.terminal === "C") {
        // Turn the trailing C-terminal label into a second one (attach name).
        last.modName = r.name;
        last.accession = r.accession;
      } else {
        // No preceding residue — treat as C-terminal attachment at end of run.
        segs.push({
          text: "",
          modified: true,
          terminal: "C",
          modName: r.name,
          accession: r.accession,
          modPos: n + 1,
          pos: n,
        });
      }
      i = close + 1;
      continue;
    }
    const aa = c;
    segs.push({ text: aa, modified: false, aa, pos });
    pos++;
    i++;
  }
  return segs;
}

export function hasInlineMods(s: string): boolean {
  return /\[[^\]\n]*\]/.test(s) || /[A-Za-z][A-Za-z]?\([^)]*\)/.test(s);
}

/** Combine a bare `sequence` with the structured `modifications` column. */
export function seqWithModsToSegments(sequence: string, mods: unknown): PTMSeg[] | null {
  const n = sequence.length;
  // position (0 = N-term, 1..n = residues, n+1 = C-term) -> {name, acc}
  const byPos = new Map<number, { name: string; acc?: string }>();
  if (Array.isArray(mods)) {
    for (const m of mods as Array<Record<string, unknown>>) {
      const name = (m?.name as string) || "PTM";
      const acc = (m?.accession as string | undefined) ?? undefined;
      const poss = m?.positions as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(poss) || poss.length === 0) continue;
      const effectiveAcc = ptmMeta(name, acc)?.accession ?? acc;
      for (const p of poss) {
        const pos = p?.position as number | undefined;
        if (typeof pos === "number" && pos >= 0 && pos <= n + 1) {
          byPos.set(pos, { name, acc: effectiveAcc });
        }
      }
    }
  }
  if (byPos.size === 0) return null;

  const segs: PTMSeg[] = [];
  const nterm = byPos.get(0);
  if (nterm) {
    segs.push({
      text: "",
      modified: true,
      terminal: "N",
      modName: nterm.name,
      accession: nterm.acc,
      modPos: 0,
      pos: -1,
    });
  }
  for (let i = 0; i < n; i++) {
    const aa = sequence[i];
    const mod = byPos.get(i + 1);
    segs.push(
      mod
        ? {
            text: aa,
            modified: true,
            modName: mod.name,
            accession: mod.acc,
            modPos: i + 1,
            aa,
            pos: i,
          }
        : { text: aa, modified: false, aa, pos: i }
    );
  }
  const cterm = byPos.get(n + 1);
  if (cterm) {
    segs.push({
      text: "",
      modified: true,
      terminal: "C",
      modName: cterm.name,
      accession: cterm.acc,
      modPos: n + 1,
      pos: n,
    });
  }
  return segs;
}

/** Per row, the PTM segments of each peptide cell keyed by column index: from
 * the inline peptidoform, or from the sequence plus the row's structured
 * `modifications` column. */
export function peptideCells(columns: string[], rows: unknown[][]): Map<number, PTMSeg[]>[] {
  const modsIdx = columns.findIndex((c) => isModificationsCol(c));
  return rows.map((row) => {
    const m = new Map<number, PTMSeg[]>();
    columns.forEach((c, j) => {
      const v = row[j];
      if (typeof v !== "string" || !isPeptideCol(c)) return;
      const segs = hasInlineMods(v) ? inlineToSegments(v) : modsIdx >= 0 ? seqWithModsToSegments(v, row[modsIdx]) : null;
      if (segs?.length) m.set(j, segs);
    });
    return m;
  });
}

/** Extract structured modifications as {name, position, aa, accession}[] for badge rendering. */
export interface PTMBadge {
  name: string;
  position: number | null;
  aa: string | null;
  accession: string | null;
  terminal?: "N" | "C";
}
export function modBadges(mods: unknown): PTMBadge[] {
  const out: PTMBadge[] = [];
  if (!Array.isArray(mods)) return out;
  for (const m of mods as Array<Record<string, unknown>>) {
    const name = (m?.name as string) || "PTM";
    const acc = (m?.accession as string | null) ?? null;
    const effectiveAcc = ptmMeta(name, acc ?? undefined)?.accession ?? acc;
    const poss = m?.positions as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(poss) || poss.length === 0) {
      out.push({ name, position: null, aa: null, accession: effectiveAcc });
      continue;
    }
    for (const p of poss) {
      const pos = (p?.position as number | null) ?? null;
      out.push({
        name,
        position: pos,
        aa: (p?.amino_acid as string | null) ?? null,
        accession: effectiveAcc,
        terminal: pos === 0 ? "N" : undefined,
      });
    }
  }
  return out;
}

/** Short superscript code for a modification name. */
export function shortCode(name?: string, accession?: string): string {
  if (!name && !accession) return "#";
  const meta = ptmMeta(name, accession);
  if (meta) return meta.code;
  // Accession known but not curated above.
  if (accession) {
    const accCode: Record<string, string> = { "UNIMOD:259": "L" };
    const c = accCode[accession.toUpperCase()];
    if (c) return c;
  }
  if (name) {
    // SILAC / isotope labels.
    const ln = name.toLowerCase().trim();
    if (ln.startsWith("label:") || ln.includes("isotopic") || ln.startsWith("silac")) return "L";
    if (ln.includes("tmt")) return "TMT";
    if (ln.includes("itraq")) return "iT";
    if (ln.includes("chelator") || ln.includes("piol")) return "Pi";
    // Mass-delta shift like "+79.9663" -> "+80".
    if (/^[+-]?\d/.test(ln)) {
      const num = parseFloat(ln.replace(/[^0-9.-]/g, "") || "0");
      return (num >= 0 ? "+" : "") + num.toFixed(0);
    }
    const letters = name.replace(/[^A-Za-z]/g, "");
    if (!letters) return "#";
    if (letters.length <= 3) return letters;
    return (letters[0] + letters[letters.length - 1]).toUpperCase();
  }
  return "#";
}

/** Stable colour per modification family — delegates to user settings. */
export function ptmColor(name?: string, accession?: string): string {
  return resolvePtmColor(name, accession);
}

function terminalLabel(terminal?: string): string {
  return terminal === "N" ? "N-terminus" : terminal === "C" ? "C-terminus" : "";
}

/**
 * Resolve the human-readable PTM name, preferring a known name but falling
 * back to resolving a UNIMOD / PSI-MOD accession to its friendly name
 * (e.g. "UNIMOD:21" -> "Phospho").
 */
function ptmDisplayName(name?: string, accession?: string): string {
  // If the name is already a friendly label (not an accession), use it.
  if (name && !/^(UNIMOD|MOD|PSI-MOD|CHEMMOD):/i.test(name)) return name;
  const meta = ptmMeta(name, accession);
  if (meta) return meta.name;
  if (name) return name;
  if (accession) return accession;
  return "Modification";
}

/** Shared body for both PTM tooltips: name, mass delta, accession, position/AA. */
function ptmTooltipLines(
  name?: string,
  accession?: string,
  extra?: { terminal?: "N" | "C"; modPos?: number; aa?: string }
): string {
  const lines: string[] = [];
  lines.push(ptmDisplayName(name, accession));
  const meta = ptmMeta(name, accession);
  const acc = meta?.accession ?? accession;
  const sub: string[] = [];
  if (meta) sub.push(`${meta.mass >= 0 ? "+" : ""}${meta.mass.toFixed(4)} Da`);
  if (acc) sub.push(acc);
  if (sub.length) lines.push(sub.join("  ·  "));
  const bits: string[] = [];
  if (extra?.terminal) bits.push(terminalLabel(extra.terminal));
  if (extra?.modPos !== undefined && extra.modPos > 0) {
    bits.push(extra.terminal ? `residue ${extra.modPos}` : `pos ${extra.modPos}`);
  }
  if (extra?.aa) bits.push(`AA ${extra.aa}`);
  if (bits.length) lines.push(bits.join("  ·  "));
  return lines.join("\n");
}

export function ptmTooltip(seg: PTMSeg): string {
  return ptmTooltipLines(seg.modName, seg.accession, {
    terminal: seg.terminal,
    modPos: seg.modPos,
    aa: seg.aa,
  });
}

/** Tooltip for a badge built from the structured `modifications` column. */
export function badgeTooltip(b: PTMBadge): string {
  return ptmTooltipLines(b.name, b.accession ?? undefined, {
    terminal: b.terminal,
    modPos: b.position ?? undefined,
    aa: b.aa ?? undefined,
  });
}
