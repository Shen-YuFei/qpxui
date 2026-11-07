import { describe, expect, it } from "vitest";
import { hasInlineMods, inlineToSegments, modBadges, ptmMeta, seqWithModsToSegments, shortCode } from "./ptm";

describe("inlineToSegments", () => {
  it("splits terminal and residue modifications", () => {
    const segs = inlineToSegments("[Acetyl]-PES[Phospho]K");
    expect(segs[0]).toMatchObject({ terminal: "N", modName: "Acetyl", accession: "UNIMOD:1" });
    expect(segs.map((s) => s.text).join("")).toBe("PESK");
    expect(segs.find((s) => s.text === "S")).toMatchObject({ modified: true, modName: "Phospho", accession: "UNIMOD:21", modPos: 3 });
  });

  it("accepts accessions and the parenthetical form", () => {
    expect(inlineToSegments("PEM[UNIMOD:35]K")[2]).toMatchObject({ modName: "Oxidation", accession: "UNIMOD:35" });
    expect(inlineToSegments("PEM(Oxidation)K")[2]).toMatchObject({ modName: "Oxidation" });
  });
});

describe("seqWithModsToSegments", () => {
  it("places structured modifications by position", () => {
    const segs = seqWithModsToSegments("PEMK", [
      { name: "Acetyl", accession: "UNIMOD:1", positions: [{ position: 0 }] },
      { name: "Oxidation", accession: "UNIMOD:35", positions: [{ position: 3 }] },
    ])!;
    expect(segs[0]).toMatchObject({ terminal: "N", modName: "Acetyl" });
    expect(segs[3]).toMatchObject({ text: "M", modified: true, modPos: 3 });
    expect(seqWithModsToSegments("PEMK", [])).toBeNull();
  });
});

describe("modBadges", () => {
  it("lists one badge per position", () => {
    const b = modBadges([{ name: "Phospho", accession: "UNIMOD:21", positions: [{ position: 2, amino_acid: "S" }, { position: 5, amino_acid: "T" }] }]);
    expect(b.map((x) => `${x.aa}${x.position}`)).toEqual(["S2", "T5"]);
  });
});

describe("short codes and metadata", () => {
  it("prefers curated codes", () => {
    expect(shortCode("Phospho")).toBe("P");
    expect(shortCode(undefined, "UNIMOD:35")).toBe("Ox");
    expect(shortCode("TMT6plex")).toBe("TMT");
    expect(shortCode("+79.9663")).toBe("+80");
  });

  it("looks up accessions case-insensitively", () => {
    expect(ptmMeta(undefined, "unimod:4")?.name).toBe("Carbamidomethyl");
  });

  it("detects inline modifications", () => {
    expect(hasInlineMods("PEPS[Phospho]K")).toBe(true);
    expect(hasInlineMods("PEPSK")).toBe(false);
  });
});
