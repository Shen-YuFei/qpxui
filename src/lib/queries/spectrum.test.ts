import { describe, expect, it } from "vitest";
import { psmKeyOf, psmLabel, whyNoSpectrum } from "./spectrum";

describe("psmLabel", () => {
  it("joins run, first scan, charge and PEP", () => {
    expect(psmLabel({ run_file_name: "a.raw", scan: [12, 13], charge: 2, posterior_error_probability: 0.00012 })).toBe("a.raw · scan 12 · 2+ · PEP 1.2e-4");
  });
  it("leaves out what the row lacks", () => {
    expect(psmLabel({ scan: 5 })).toBe("scan 5");
    expect(psmLabel({})).toBe("");
  });
});

describe("psm rows", () => {
  const cols = ["Peptidoform", "scan", "charge", "run_file_name", "mz_array"];
  it("keys a row by peptidoform, run, first scan and charge", () => {
    expect(psmKeyOf(cols, ["PEPTIDE", [7, 8], 2, "a.raw", [1]])).toEqual({ peptidoform: "PEPTIDE", run_file_name: "a.raw", scan: 7, charge: 2 });
    expect(psmKeyOf(["peptidoform"], ["PEPK"])).toEqual({ peptidoform: "PEPK", run_file_name: null, scan: null, charge: null });
  });
  it("says why a row has no spectrum", () => {
    expect(whyNoSpectrum(cols, ["PEPTIDE", 7, 2, "a.raw", [100.1]], true)).toBe("");
    expect(whyNoSpectrum(cols, ["", 7, 2, "a.raw", [100.1]], true)).toBe("This PSM has no peptidoform");
    expect(whyNoSpectrum(cols, ["PEPTIDE", 7, 2, "a.raw", []], true)).toBe("This PSM has no stored peaks");
    // Peaks not read: the viewer reads them itself.
    expect(whyNoSpectrum(["peptidoform"], ["PEPTIDE"], false)).toBe("");
  });
});
