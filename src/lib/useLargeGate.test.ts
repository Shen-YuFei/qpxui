import { describe, expect, it, vi } from "vitest";

const largeViews = vi.fn();
vi.mock("./report", () => ({ largeViews: (...a: unknown[]) => largeViews(...a), scanBytes: () => 0 }));
const { useLargeGate } = await import("./useLargeGate");

describe("useLargeGate", () => {
  it("does not scan a view whose footer could not be read", async () => {
    largeViews.mockRejectedValueOnce(new Error("IO Error: Range request for x failed"));
    const { gate, check } = useLargeGate();
    const go = vi.fn();
    await check([{ ref: undefined, cols: [] }], go);
    expect(go).not.toHaveBeenCalled();
    expect(gate).toMatchObject({ checking: false, blocked: false, error: "IO Error: Range request for x failed" });
  });

  it("runs at once when no view is large", async () => {
    largeViews.mockResolvedValueOnce([]);
    const { gate, check } = useLargeGate();
    const go = vi.fn();
    await check([{ ref: undefined, cols: [] }], go);
    expect(go).toHaveBeenCalledOnce();
    expect(gate).toMatchObject({ checking: false, blocked: false, error: "" });
  });
});
