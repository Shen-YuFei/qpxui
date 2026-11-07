import { describe, expect, it } from "vitest";
import { annotatePeaks, fragmentIons, modMass, modUnimodId, parsePeptidoform, precursorMz, toProForma } from "./fragments";

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
