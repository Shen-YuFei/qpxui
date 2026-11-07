// Pre-flight checks for "Download to cache": compare the selected files'
// total size with the free space on the cache disk, refuse what cannot fit
// and ask before starting a very large transfer.
import { ask, message } from "@tauri-apps/plugin-dialog";
import { api, type ViewInfo } from "./api";
import { fmtBytes } from "./format";

/** Ids of downloads still running, so leaving a source can cancel them. */
const active = new Set<string>();

export function trackDownload(id: string) {
  active.add(id);
}

export function untrackDownload(id: string) {
  active.delete(id);
}

/** Cancel one running download (no-op when it already finished). */
export async function cancelDownload(id: string) {
  if (id) await api.cancelDownload(id);
}

/** Cancel every running download, e.g. on "New source". */
export function cancelAllDownloads() {
  for (const id of active) void cancelDownload(id);
}

/** Ask for confirmation above this size. */
export const CONFIRM_BYTES = 2 * 1024 ** 3;

export function totalBytes(views: ViewInfo[]): number {
  return views.reduce((s, v) => s + v.sizeBytes, 0);
}

/** True when the download may start. Shows an alert or a confirm otherwise. */
export async function confirmDownload(views: ViewInfo[], kind: "portal" | "s3"): Promise<boolean> {
  const need = totalBytes(views);
  const { free, reserve } = await api.cacheFreeSpace(kind);
  if (need + reserve > free) {
    await message(
      `The selected files need ${fmtBytes(need)}, but only ${fmtBytes(free)} is free on the cache disk ` +
        `(${fmtBytes(reserve)} is kept spare).\n\nFree some space, select fewer files, or use Stream, which reads only the parts each query needs.`,
      { title: "Not enough disk space", kind: "error" }
    );
    return false;
  }
  if (need >= CONFIRM_BYTES) {
    return ask(
      `This downloads ${fmtBytes(need)} to the cache. About ${fmtBytes(free - need)} will be left free.\n\nYou can cancel at any time; partial files are removed. Stream opens the same files without downloading them.`,
      { title: "Large download", kind: "warning", okLabel: "Download", cancelLabel: "Cancel" }
    );
  }
  return true;
}
