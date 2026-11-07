// Live progress of "Download to cache" runs. The Rust side emits a
// `download-progress` event for every chunk of a file it transfers; this
// module keeps the latest event per file of each running download.
import { reactive } from "vue";
import { listen } from "@tauri-apps/api/event";
import type { DownloadProgress } from "./api";

/** Latest progress per file name, for each running download id. */
export const progress = reactive<Record<string, Record<string, DownloadProgress>>>({});

/** Start collecting a download's progress. */
export function startProgress(download: string) {
  progress[download] = {};
}

/** Forget a download's progress once it has ended. */
export function endProgress(download: string) {
  delete progress[download];
}

/** Keep one event. Events of a download that has ended can still arrive;
 * they are dropped. */
export function record(p: DownloadProgress) {
  const files = progress[p.download];
  if (files) files[p.file] = p;
}

/** Aggregate percent across the files with a known total (null if none). */
export function overall(files: DownloadProgress[]): number | null {
  const known = files.filter((b) => b.total > 0);
  if (!known.length) return null;
  const total = known.reduce((s, b) => s + b.total, 0);
  const done = known.reduce((s, b) => s + b.done, 0);
  return (done / total) * 100;
}

let installed = false;

/** Register the Tauri event listener once. */
export function installProgress() {
  if (installed) return;
  installed = true;
  listen<DownloadProgress>("download-progress", (event) => record(event.payload)).catch((e) =>
    console.warn("progress listener failed", e)
  );
}
