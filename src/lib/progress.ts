// Reactive view of download progress. The Rust side emits a
// `download-progress` Tauri event for every chunk of a transferred file;
// this module turns those into a simple reactive map keyed by file name.
import { reactive } from "vue";
import { listen } from "@tauri-apps/api/event";

export interface BarState {
  file: string;
  done: number;
  total: number;
  percent: number;
  phase: string; // "downloading" | "done" | "error"
}

export const progress = reactive<Record<string, BarState>>({});

/** Aggregate percent across all bars with a known total (or NaN if none). */
export function overall(): number | null {
  const known = Object.values(progress).filter((b) => b.total > 0);
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
  listen<BarState>("download-progress", (event) => {
    progress[event.payload.file] = event.payload;
  }).catch((e) => console.warn("progress listener failed", e));
}
