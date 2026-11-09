import { describe, expect, it } from "vitest";
import type { PortalDataset } from "./api";
import { filterRegistry, nextSort } from "./registry";

const rows: PortalDataset[] = [
  { accession: "PXD002", title: "Human plasma", organism: "Homo sapiens", peptides: 50 },
  { accession: "PXD001", title: "Yeast", organism: "Saccharomyces cerevisiae", peptides: null, datasetRef: "PXD001-yeast" },
  { accession: "PXD003", title: "Mouse liver", instrument: "Orbitrap", collectionTitle: "Liver atlas", peptides: 50 },
];
const accs = (xs: PortalDataset[]) => xs.map((x) => x.accession);

describe("filterRegistry", () => {
  it("searches accession, title, organism, instrument and collection", () => {
    expect(accs(filterRegistry(rows, " HOMO ", "accession", false))).toEqual(["PXD002"]);
    expect(accs(filterRegistry(rows, "atlas", "accession", false))).toEqual(["PXD003"]);
    expect(accs(filterRegistry(rows, "orbitrap", "accession", false))).toEqual(["PXD003"]);
  });
  it("sorts by reference, either way", () => {
    expect(accs(filterRegistry(rows, "", "accession", false))).toEqual(["PXD001", "PXD002", "PXD003"]);
    expect(accs(filterRegistry(rows, "", "accession", true))).toEqual(["PXD003", "PXD002", "PXD001"]);
  });
  it("sorts counts with missing values last and ties by reference", () => {
    expect(accs(filterRegistry(rows, "", "peptides", true))).toEqual(["PXD002", "PXD003", "PXD001"]);
    expect(accs(filterRegistry(rows, "", "peptides", false))).toEqual(["PXD002", "PXD003", "PXD001"]);
  });
  it("leaves the input order alone", () => {
    filterRegistry(rows, "", "accession", false);
    expect(accs(rows)).toEqual(["PXD002", "PXD001", "PXD003"]);
  });
});

describe("nextSort", () => {
  it("reverses the current key and starts counts largest-first", () => {
    expect(nextSort({ key: "accession", desc: false }, "accession")).toEqual({ key: "accession", desc: true });
    expect(nextSort({ key: "accession", desc: false }, "peptides")).toEqual({ key: "peptides", desc: true });
    expect(nextSort({ key: "peptides", desc: true }, "accession")).toEqual({ key: "accession", desc: false });
  });
});
