import { describe, expect, it } from "vitest";
import type { FragmentIon, Peak } from "./fragments";
import { B_COLOR, Y_COLOR, ionColor, spectrumOption, type SpectrumChart } from "./spectrumChart";

const ion = (type: "b" | "y", num: number, mz: number, loss = ""): FragmentIon =>
  ({ type, num, charge: 1, loss, mz, label: `${type}${num}${loss}` }) as FragmentIon;

const peaks: Peak[] = [
  { mz: 200, intensity: 50 },
  { mz: 300, intensity: 200, ion: ion("b", 2, 300.002), error: 6.7 },
  { mz: 400, intensity: 100, ion: ion("y", 3, 399.99, "-H2O"), error: -25 },
];

function chart(over: Partial<SpectrumChart> = {}): any {
  return spectrumOption({
    peaks,
    mirror: null,
    precursorMz: 500,
    showLabels: true,
    unit: "ppm",
    tolerance: 20,
    colors: { dim: "#dim", border: "#border", grey: "#grey" },
    ...over,
  });
}
const series = (o: any, name: string) => o.series.find((s: any) => s.name === name);

describe("ionColor", () => {
  it("colours b and y ions, lighter with a neutral loss", () => {
    expect(ionColor(peaks[0])).toBe("");
    expect(ionColor(peaks[1])).toBe(B_COLOR);
    expect(ionColor(peaks[2])).toBe(`${Y_COLOR}99`);
  });
});

describe("spectrumOption", () => {
  it("draws sticks by ion type at relative intensity, on an axis past the precursor", () => {
    const o = chart();
    expect(o.series.map((s: any) => s.name)).toEqual(["unmatched", "b", "y", "peaks", "error"]);
    expect(series(o, "unmatched").data).toEqual([[200, 25]]);
    expect(series(o, "b").data).toEqual([[300, 100]]);
    expect(series(o, "y").data).toEqual([[400, 50]]);
    expect(o.xAxis[0].max).toBe(Math.ceil(500 * 1.04));
    expect(o.yAxis[0]).toMatchObject({ min: 0, max: 112 });
  });

  it("labels matched tips, most intense first, unless labels are off", () => {
    const tips = series(chart(), "peaks").data;
    expect(tips.map((t: any) => t.value)).toEqual([[300, 100], [400, 50], [200, 25]]);
    expect(tips.map((t: any) => t.label.show)).toEqual([true, true, false]);
    expect(tips[1].label).toMatchObject({ formatter: "y3-H2O", color: `${Y_COLOR}99` });
    const off = series(chart({ showLabels: false }), "peaks").data;
    expect(off.every((t: any) => !t.label.show)).toBe(true);
  });

  it("spans the error axis over the tolerance or the largest error", () => {
    const o = chart();
    expect(series(o, "error").data.map((e: any) => e.value)).toEqual([[300, 6.7], [400, -25]]);
    expect(o.yAxis[1].name).toBe("ppm");
    expect(o.yAxis[1].max).toBeCloseTo(27.5);
    expect(o.yAxis[1].min).toBeCloseTo(-27.5);
    expect(chart({ tolerance: 50 }).yAxis[1].max).toBeCloseTo(55);
  });

  it("mirrors a reference spectrum downwards on a symmetric axis", () => {
    const o = chart({ mirror: { label: "theoretical", peaks: [{ mz: 300, intensity: 1, ion: ion("b", 2, 300) }] } });
    expect(o.series.map((s: any) => s.name)).toEqual([
      "unmatched", "b", "y", "mirror unmatched", "mirror b", "mirror y", "mirror peaks", "peaks", "error",
    ]);
    expect(series(o, "mirror b").data).toEqual([[300, -100]]);
    expect(o.yAxis[0]).toMatchObject({ min: -125, max: 125, interval: 25 });
    expect(o.graphic.map((g: any) => g.style.text)).toEqual(["PSM", "theoretical"]);
  });

  it("describes a peak in its tooltip", () => {
    expect(chart().tooltip.formatter({ data: { idx: 1 } })).toBe(
      `<b style="color:${B_COLOR}">b2</b><br/>m/z <b>300.0000</b><br/>intensity 2.000e+2 (100.0%)<br/>theoretical 300.0020<br/>error 6.70 ppm`,
    );
  });
});
