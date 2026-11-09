import { describe, expect, it } from "vitest";
import { CATEGORICAL, type ChartTheme } from "./charts";
import { shades } from "./colours";
import { colourScale, diseaseGroup, isAnnotated } from "./sampleColours";

const theme: ChartTheme = {
  text: "#1f2328", dim: "#59636e", border: "#d1d9e0", accent: "#1a5fb4", bg: "#ffffff", grid: "#e2e7ec", axis: "#b8c2cc",
  pooled: "#0b3a6a", other: "#a3acb6", cat: CATEGORICAL, font: "font",
};
const [BLUE, ORANGE, GREEN, , , , PURPLE] = CATEGORICAL;

describe("sample colours", () => {
  it("groups diseases by name", () => {
    expect(diseaseGroup("Normal")).toBe("Healthy or normal");
    expect(diseaseGroup("metaplastic breast carcinomas")).toBe("Cancer");
    expect(diseaseGroup("COVID-19")).toBe("Other disease");
    expect(isAnnotated("not available")).toBe(false);
    expect(isAnnotated(" Not Applicable ")).toBe(false);
  });

  it("gives a group's hue to its values, in shades, and puts the unannotated last", () => {
    const values = ["lung carcinoma", "normal", "breast cancer", "normal", "not available"];
    const groups = new Map(values.filter(isAnnotated).map((v) => [v, diseaseGroup(v)]));
    const s = colourScale("disease", values, groups, theme);
    expect(s.order).toEqual(["normal", "breast cancer", "lung carcinoma", "not available"]);
    expect(s.colourOf("normal")).toBe(GREEN);
    expect([s.colourOf("breast cancer"), s.colourOf("lung carcinoma")]).toEqual(shades(PURPLE, 2));
    expect(s.colourOf("not available")).not.toBe(theme.other);
  });

  it("takes the palette by count until the groups are known", () => {
    const s = colourScale("disease", ["b", "a", "a"], null, theme);
    expect(s.order).toEqual(["a", "b"]);
    expect([s.colourOf("a"), s.colourOf("b")]).toEqual([BLUE, ORANGE]);
  });

  it("keeps fixed slots for sex and greys values past the palette", () => {
    const sex = colourScale("sex", ["male", "female", "female"], null, theme);
    expect([sex.colourOf("female"), sex.colourOf("male")]).toEqual([PURPLE, GREEN]);

    const many = colourScale("cell_line", ["a", "b", "c", "d", "e", "f", "g", "h", "i"], null, theme);
    expect(many.order.slice(0, 7).map(many.colourOf)).toEqual(CATEGORICAL.slice(0, 7));
    expect(["h", "i"].map(many.colourOf)).toEqual([theme.other, theme.other]);
  });

  it("orders developmental stages by age", () => {
    expect(colourScale("developmental_stage", ["adult", "child", "embryo", "adult"], null, theme).order).toEqual(["embryo", "child", "adult"]);
  });
});
