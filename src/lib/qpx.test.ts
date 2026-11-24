import { describe, expect, it } from "vitest";
import { COL, cvMap, structScoreDirections } from "./qpx";

describe("structScoreDirections", () => {
  it("reads each score's direction from the qpx.struct_lists footer", () => {
    const layout = JSON.stringify({
      additional_scores: [{ name: "pg_pep", higher_better: false }, { name: "pg_maxlfq_quality", higher_better: true }, { name: "x" }],
      cv_params: [{ name: "quantification_method" }],
    });
    expect(structScoreDirections(layout)).toEqual({ pg_pep: false, pg_maxlfq_quality: true, x: null });
    expect(structScoreDirections(null)).toEqual({});
  });
});

describe("cvMap", () => {
  it("reads a list of {cv_name, cv_value} structs", () => {
    expect(cvMap([{ cv_name: "Mass Analyzer", cv_value: "FTMS" }, { cv_name: "instrument", cv_value: null }])).toEqual({
      "mass analyzer": "FTMS",
      instrument: "",
    });
  });
  it("reads a MAP and a struct with one field per name, skipping nested values", () => {
    expect(cvMap({ "Collision Energy": 30, dissociation: "HCD", nested: { a: 1 }, none: null })).toEqual({
      "normalized collision energy": "30",
      dissociation: "HCD",
    });
  });
  it("maps converter-specific names to one key", () => {
    expect(cvMap([{ name: "fragmentation method", value: "CID" }])).toEqual({ "dissociation method": "CID" });
    expect(cvMap({ fragmentation: "HCD", "mass analyzer": "FTMS" })).toEqual({ "dissociation method": "HCD", "mass analyzer": "FTMS" });
  });
  it("gives an empty map for missing values", () => {
    expect(cvMap(null)).toEqual({});
    expect(cvMap(undefined)).toEqual({});
  });
});

describe("COL", () => {
  it("maps each column name to itself", () => {
    for (const [k, v] of Object.entries(COL)) expect(v).toBe(k);
    expect(COL.anchor_protein).toBe("anchor_protein");
  });
});
