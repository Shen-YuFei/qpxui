import { describe, expect, it } from "vitest";
import { cvMap } from "./qpx";

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
  });
  it("gives an empty map for missing values", () => {
    expect(cvMap(null)).toEqual({});
    expect(cvMap(undefined)).toEqual({});
  });
});
