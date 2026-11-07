import { describe, expect, it } from "vitest";
import { annotatePeaks, fragmentIons, parsePeptidoform } from "./fragments";
import { coverageMarks, ionTableCharges, ionTableRows, matchedIonKeys, spectrumStats } from "./spectrumSummary";

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
