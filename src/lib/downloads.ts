// "Download to cache" for the S3 and portal pickers: pre-flight checks that
// compare the selected files' total size with the free space on the cache
// disk, and the running download with its progress and cancel.
import { ask, message } from "@tauri-apps/plugin-dialog";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api, type ViewInfo } from "./api";
import { isCancelled } from "./errors";
import { fmtBytes } from "./format";
import { endProgress, installProgress, progress, startProgress } from "./progress";

/** Ids of downloads still running, so leaving a source can cancel them. */
const active = new Set<string>();

/** Cancel one running download (no-op when it already finished). */
async function cancelDownload(id: string) {
  if (id) await api.cancelDownload(id);
}

/** Cancel every running download, e.g. on "New source". */
export function cancelAllDownloads() {
  for (const id of active) void cancelDownload(id);
}

function newId(): string {
  // crypto.randomUUID needs Safari 15.4 / macOS 12.3 or later.
  return crypto.randomUUID?.() ?? `d${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A picker's download: its id while one runs, its progress, and cancel.
 * Leaving the picker ("New source", switching source) cancels it. */
export function useDownload() {
  const id = ref("");
  const cancelling = ref(false);
  let unmounted = false;
  onMounted(installProgress);
  onBeforeUnmount(() => {
    unmounted = true;
    void cancelDownload(id.value);
  });

  /** Per-file progress of the running download. */
  const files = computed(() => Object.values(progress[id.value] ?? {}));

  async function cancel() {
    if (!id.value) return;
    cancelling.value = true;
    await cancelDownload(id.value);
  }

  /** Run one transfer under a fresh download id. Resolves to its result, or
   * to null when it was cancelled. */
  async function run<T>(transfer: (id: string) => Promise<T>): Promise<T | null> {
    const my = newId();
    id.value = my;
    cancelling.value = false;
    active.add(my);
    startProgress(my);
    try {
      return await transfer(my);
    } catch (e) {
      if (isCancelled(e)) return null;
      throw e;
    } finally {
      active.delete(my);
      endProgress(my);
      if (id.value === my) id.value = "";
      cancelling.value = false;
    }
  }

  return { id, cancelling, files, cancel, run, unmounted: () => unmounted };
}

/** Ask for confirmation above this size. */
export const CONFIRM_BYTES = 2 * 1024 ** 3;

/** Sum of the views' sizes, or null when any of them is unknown. */
export function totalBytes(views: ViewInfo[]): number | null {
  let total = 0;
  for (const view of views) {
    if (view.sizeBytes === null) return null;
    total += view.sizeBytes;
  }
  return total;
}

/** True when the download may start. Shows an alert or a confirm otherwise. */
export async function confirmDownload(views: ViewInfo[], kind: "portal" | "s3"): Promise<boolean> {
  // An unknown size counts as 0: the checks use the sizes that are known.
  const need = views.reduce((s, v) => s + (v.sizeBytes ?? 0), 0);
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
