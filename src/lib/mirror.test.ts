import { describe, expect, it } from "vitest";
import { parsePeptidoform } from "./fragments";
import { KOINA_MODELS, koinaSequence, similarity, theoretical, usiInterpretation } from "./mirror";

describe("koinaSequence", () => {
  const model = KOINA_MODELS[0];

  it("writes Unimod accessions the model accepts", () => {
    expect(koinaSequence(parsePeptidoform("PEPC[Carbamidomethyl]K"), model).seq).toBe("PEPC[UNIMOD:4]K");
  });

  it("explains why a peptidoform cannot be predicted", () => {
    expect(koinaSequence(parsePeptidoform("PEPK-[Amidated]"), model).why).toMatch(/C-terminal/);
  });
});

describe("usiInterpretation", () => {
  it("keeps colons inside the peptidoform", () => {
    expect(usiInterpretation("mzspec:PXD000001:run1:scan:42:PEPM[UNIMOD:35]K/2")).toEqual({ peptidoform: "PEPM[UNIMOD:35]K", charge: 2 });
    expect(usiInterpretation("mzspec:PXD000001:run1:scan:42")).toBeNull();
  });
});

describe("similarity", () => {
  it("is 1 for identical spectra and 0 without shared peaks", () => {
    const t = theoretical(parsePeptidoform("PEPTIDE"), 1).peaks;
    expect(similarity(t, t, { value: 10, unit: "ppm" }).cosine).toBeCloseTo(1);
    const shifted = t.map((p) => ({ ...p, mz: p.mz + 5 }));
    expect(similarity(t, shifted, { value: 10, unit: "ppm" }).matched).toBe(0);
  });
});
