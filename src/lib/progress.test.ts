import { expect, it } from "vitest";
import type { DownloadProgress } from "./api";
import { endProgress, overall, progress, record, startProgress } from "./progress";

const event = (download: string, file: string, done: number, phase: DownloadProgress["phase"] = "downloading") =>
  ({ download, file, done, total: 100, percent: done, phase }) satisfies DownloadProgress;

it("a finished download's files do not count toward the next one", () => {
  startProgress("a");
  record(event("a", "a.psm.parquet", 100, "done"));
  endProgress("a");
  startProgress("b");
  record(event("b", "b.pg.parquet", 0));
  record(event("b", "c.pg.parquet", 50));
  expect(overall(Object.values(progress.b))).toBe(25);
  endProgress("b");
});

it("drops events that arrive after their download ended", () => {
  startProgress("x");
  endProgress("x");
  record(event("x", "late.psm.parquet", 10));
  expect(progress.x).toBeUndefined();
});

it("has no overall percent before any size is known", () => {
  expect(overall([])).toBeNull();
  expect(overall([{ ...event("y", "f", 0), total: 0 }])).toBeNull();
});
