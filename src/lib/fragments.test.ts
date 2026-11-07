import { describe, expect, it } from "vitest";
import {
  annotatePeaks,
  coverageMarks,
  fragmentIons,
  ionTableCharges,
  ionTableRows,
  matchedIonKeys,
  modMass,
  modUnimodId,
  parsePeptidoform,
  precursorMz,
  spectrumStats,
  toProForma,
} from "./fragments";

describe("modMass", () => {
  it("reads names, accessions, ProForma prefixes and mass shifts", () => {
    expect(modMass("Oxidation")).toBe(15.994915);
    expect(modMass("Oxidation (M)")).toBe(15.994915);
    expect(modMass("UNIMOD:21")).toBe(79.966331);
    expect(modMass("U:Carbamidomethyl")).toBe(57.021464);
    expect(modMass("+42.0106")).toBe(42.0106);
    expect(modMass("NotAMod")).toBeNull();
  });

  it("maps a mass shift to the closest known accession", () => {
    expect(modUnimodId("+79.966")).toBe(21);
  });
});

describe("parsePeptidoform", () => {
  it("reads ProForma terminal and residue modifications", () => {
    const p = parsePeptidoform("[Acetyl]-PEPM[Oxidation]K/2");
    expect(p.residues.join("")).toBe("PEPMK");
    expect(p.nterm).toBe(42.010565);
    expect(p.mods[3]).toBe(15.994915);
    expect(p.unknown).toEqual([]);
  });

  it("reads the OpenMS parenthetical form", () => {
    const p = parsePeptidoform(".(Acetyl)PEPM(Oxidation)K.");
    expect(p.residues.join("")).toBe("PEPMK");
    expect(p.ntermNames).toEqual(["Acetyl"]);
    expect(p.modNames[3]).toEqual(["Oxidation"]);
  });

  it("writes ProForma with Unimod accessions", () => {
    expect(toProForma(parsePeptidoform("[Acetyl]-PEPM[Oxidation (M)]K"))).toBe("[UNIMOD:1]-PEPM[UNIMOD:35]K");
  });
});

describe("fragment masses", () => {
  const p = parsePeptidoform("PEPTIDE");

  it("computes the precursor m/z", () => {
    expect(precursorMz(p, 2)).toBeCloseTo(400.687258, 5);
  });

  it("computes b and y ions", () => {
    const ions = fragmentIons(p, 1, false);
    expect(ions.find((x) => x.label === "b2")!.mz).toBeCloseTo(227.102633, 5);
    expect(ions.find((x) => x.label === "y1")!.mz).toBeCloseTo(148.060434, 5);
    expect(ions.filter((x) => x.type === "b")).toHaveLength(6);
  });

  it("annotates peaks within the tolerance only", () => {
    const ions = fragmentIons(p, 1, false);
    const [hit, miss] = annotatePeaks([227.1027, 300], [10, 5], ions, { value: 20, unit: "ppm" });
    expect(hit.ion?.label).toBe("b2");
    expect(Math.abs(hit.error!)).toBeLessThan(1);
    expect(miss.ion).toBeUndefined();
  });
});

describe("annotation summaries", () => {
  const p = parsePeptidoform("PEPTIDE");
  const ions = fragmentIons(p, 2, false);
  const at = (label: string) => ions.find((x) => x.label === label)!.mz;
  // b2 and y3 match; the third peak matches nothing.
  const peaks = annotatePeaks([at("b2"), at("y3"), 1000], [30, 10, 60], ions, { value: 20, unit: "ppm" });

  it("counts annotated peaks, TIC share and explained cleavages", () => {
    // b2 explains the cleavage after residue 2, y3 the one after residue 4.
    expect(spectrumStats(p, peaks)).toEqual({ peaks: 3, annotated: 2, ticPct: 40, b: 1, y: 1, cleav: 2, n: 7 });
  });

  it("marks the cleavages after the matched b and y ions", () => {
    const m = coverageMarks(p, peaks);
    expect(m.map((x) => x.aa).join("")).toBe("PEPTIDE");
    expect(m.map((x, k) => (x.b ? k : -1)).filter((k) => k >= 0)).toEqual([1]);
    expect(m.map((x, k) => (x.y ? k : -1)).filter((k) => k >= 0)).toEqual([3]);
    expect(m.some((x) => x.mod)).toBe(false);
  });

  it("lays out the ion table with the matched ions marked", () => {
    const charges = ionTableCharges(ions);
    expect(charges).toEqual([1, 2]);
    const rows = ionTableRows(p, ions, matchedIonKeys(peaks), charges);
    expect(rows).toHaveLength(7);
    expect(rows[1].bNum).toBe(2);
    expect(rows[1].b[0]).toEqual({ mz: at("b2"), hit: true });
    expect(rows[1].b[1]?.hit).toBe(false);
    expect(rows[4].yNum).toBe(3);
    expect(rows[4].y[0]?.hit).toBe(true);
    // No b ion past the last cleavage, no y ion before the first.
    expect(rows[6].b).toEqual([null, null]);
    expect(rows[0].y).toEqual([null, null]);
  });
});
