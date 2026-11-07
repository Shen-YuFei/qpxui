// Pre-flight checks for "Download to cache": compare the selected files'
// total size with the free space on the cache disk, refuse what cannot fit
// and ask before starting a very large transfer.
import { ask, message } from "@tauri-apps/plugin-dialog";
import { api, type ViewInfo } from "./api";
import { fmtBytes } from "./format";

/** Ask for confirmation above this size. */
export const CONFIRM_BYTES = 2 * 1024 ** 3;

export function totalBytes(views: ViewInfo[]): number {
  return views.reduce((s, v) => s + (v.sizeBytes || 0), 0);
}

/** True when the download may start. Shows an alert or a confirm otherwise. */
export async function confirmDownload(views: ViewInfo[], kind: "portal" | "s3"): Promise<boolean> {
  const need = totalBytes(views);
  let free: number | null = null;
  let reserve = 0;
  try {
    const s = await api.cacheFreeSpace(kind);
    free = s.free;
    reserve = s.reserve;
  } catch {
    /* unknown free space: the backend checks again before writing */
  }
  if (free != null && need + reserve > free) {
    await message(
      `The selected files need ${fmtBytes(need)}, but only ${fmtBytes(free)} is free on the cache disk ` +
        `(${fmtBytes(reserve)} is kept spare).\n\nFree some space, select fewer files, or use Stream, which reads only the parts each query needs.`,
      { title: "Not enough disk space", kind: "error" }
    );
    return false;
  }
  if (need >= CONFIRM_BYTES) {
    const left = free != null ? ` About ${fmtBytes(free - need)} will be left free.` : "";
    return ask(
      `This downloads ${fmtBytes(need)} to the cache.${left}\n\nYou can cancel at any time; partial files are removed. Stream opens the same files without downloading them.`,
      { title: "Large download", kind: "warning", okLabel: "Download", cancelLabel: "Cancel" }
    );
  }
  return true;
}
