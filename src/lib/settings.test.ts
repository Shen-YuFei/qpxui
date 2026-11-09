import { expect, it } from "vitest";
import { effectivePtmColor, resolvePtmColor } from "./settings";

it("uses the longest matching PTM keyword, with accession taking priority", () => {
  expect(resolvePtmColor("Dimethyl (K)")).toBe(effectivePtmColor("dimethyl"));
  expect(resolvePtmColor("Trimethyl (K)")).toBe(effectivePtmColor("trimethyl"));
  expect(resolvePtmColor("Dethiomethyl")).toBe(effectivePtmColor("dimethyl"));
  expect(resolvePtmColor("Methylation")).toBe(effectivePtmColor("methyl"));
  expect(resolvePtmColor("Trimethyl (K)", "UNIMOD:34")).toBe(effectivePtmColor("methyl"));
  expect(resolvePtmColor("Xyzzy")).toBe(effectivePtmColor("unknown"));
});
