import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { savePng, saveText } from "./export";

vi.mock("./api", () => ({ api: { saveExport: vi.fn() } }));

describe("native exports", () => {
  beforeEach(() => vi.mocked(api.saveExport).mockReset());

  it("sends UTF-8 text and a suggested filename to the single native command", async () => {
    vi.mocked(api.saveExport).mockResolvedValue("/chosen/report.csv");
    const text = "sample,value\n测试,42\n";
    expect(await saveText("sample report", text)).toBe("/chosen/report.csv");
    expect(api.saveExport).toHaveBeenCalledExactlyOnceWith(
      "sample_report.csv", [{ name: "CSV", extensions: ["csv"] }],
      btoa(String.fromCharCode(...new TextEncoder().encode(text))),
    );
  });

  it("sends PNG bytes without the data URL header and preserves cancellation", async () => {
    vi.mocked(api.saveExport).mockResolvedValue(null);
    expect(await savePng("chart", "data:image/png;base64,iVBORw0KGgo=")).toBeNull();
    expect(api.saveExport).toHaveBeenCalledExactlyOnceWith(
      "chart.png", [{ name: "PNG image", extensions: ["png"] }], "iVBORw0KGgo=",
    );
  });
});
