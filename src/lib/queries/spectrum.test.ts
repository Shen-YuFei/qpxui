import { describe, expect, it } from "vitest";
import { psmLabel } from "./spectrum";

describe("psmLabel", () => {
  it("joins run, first scan, charge and PEP", () => {
    expect(psmLabel({ run_file_name: "a.raw", scan: [12, 13], charge: 2, posterior_error_probability: 0.00012 })).toBe("a.raw · scan 12 · 2+ · PEP 1.2e-4");
  });
  it("leaves out what the row lacks", () => {
    expect(psmLabel({ scan: 5 })).toBe("scan 5");
    expect(psmLabel({})).toBe("");
  });
});
