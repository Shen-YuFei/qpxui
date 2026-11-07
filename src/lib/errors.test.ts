import { describe, expect, it } from "vitest";
import { engineErrorText, isCancelled } from "./errors";

const hinted = (msg: string) => engineErrorText(new Error(msg)) !== msg;

describe("isCancelled", () => {
  it("recognises the backend's and the engine's cancellations only", () => {
    expect(isCancelled("cancelled")).toBe(true);
    expect(isCancelled(new Error("cancelled"))).toBe(true);
    expect(isCancelled("PXD1.cancel-test.psm.parquet: got 10 of 20 bytes")).toBe(false);
    expect(isCancelled(new Error("IO Error: Range request for x failed with error: request cancelled"))).toBe(false);
  });
});

describe("engineErrorText", () => {
  it("hints at the network for failed range reads of streamed files", () => {
    expect(
      hinted('IO Error: Range request for http://127.0.0.1:1/t/i/x.parquet did returned non-success status: 502 "Bad Gateway"'),
    ).toBe(true);
    expect(hinted("Range request for http://127.0.0.1:1/t/i/x.parquet failed with error: NetworkError: Load failed\"")).toBe(true);
    expect(hinted("IO Error: Opening file x.parquet failed: Unexpected return status from server (403)")).toBe(true);
  });

  it("leaves other errors alone", () => {
    expect(hinted("Out of Range Error: Overflow in subtraction of INT64 (9223216857644211371 - -9223357690336741277)!")).toBe(false);
    expect(hinted("Conversion Error: Could not convert string 'x' to INT32 in row 14031")).toBe(false);
    expect(hinted("Invalid Input Error: Failed to fetch required secret key 'x' from secret 'y'")).toBe(false);
    expect(engineErrorText("Binder Error: column not found")).toBe("Binder Error: column not found");
  });
});
