import { describe, expect, it } from "vitest";
import { commonPrefix, escapeHtml, specToCsv, toCsv } from "./charts";

describe("commonPrefix", () => {
  it("cuts a shared run-name prefix at a separator", () => {
    expect(commonPrefix(["UM_F_50cm_01", "UM_F_50cm_02", "UM_F_50cm_03", "UM_F_50cm_10"])).toBe("UM_F_50cm_");
  });

  it("ignores short prefixes and few labels", () => {
    expect(commonPrefix(["ab_1", "ab_2", "ab_3", "ab_4"])).toBe("");
    expect(commonPrefix(["long_prefix_1", "long_prefix_2"])).toBe("");
  });
});

describe("CSV export", () => {
  it("quotes cells with separators and quotes", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], [null, { k: 1 }]])).toBe('a,b\n"x,y","say ""hi"""\n,"{""k"":1}"\n');
  });

  it("expands box-plot quantiles into columns", () => {
    const csv = specToCsv({ kind: "box", labels: ["s1"], series: [{ name: "int", values: [[1, 2, 3, 4, 5]] }], xName: "sample" });
    expect(csv).toBe("sample,int_p05,int_q1,int_median,int_q3,int_p95\ns1,1,2,3,4,5\n");
  });
});

describe("escapeHtml", () => {
  it("escapes markup in tooltips", () => {
    expect(escapeHtml('<b>"x" & y</b>')).toBe("&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
  });
});
