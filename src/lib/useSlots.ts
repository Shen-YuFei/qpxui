import { reactive } from "vue";
import type { ChartSpec } from "./charts";

export interface Slot {
  spec: ChartSpec | null;
  loading: boolean;
  error: string;
  /** Not applicable to this dataset (missing columns) — hide the card. */
  skip: boolean;
}

/** Reactive chart slots filled one query at a time (duckdb-wasm runs queries
 * serially anyway), with a progress counter like the portal's
 * "Computing statistics · n of N". */
export function useSlots<K extends string>(keys: readonly K[]) {
  const slots = reactive(
    Object.fromEntries(keys.map((k) => [k, { spec: null, loading: true, error: "", skip: false }]))
  ) as Record<K, Slot>;
  const progress = reactive({ done: 0, total: keys.length, running: false });

  async function run(jobs: Partial<Record<K, () => Promise<ChartSpec | null>>>) {
    progress.running = true;
    progress.done = 0;
    for (const k of keys) {
      const s = slots[k];
      const job = jobs[k];
      if (!job) {
        s.skip = true;
        s.loading = false;
        progress.done++;
        continue;
      }
      s.loading = true;
      s.error = "";
      try {
        const spec = await job();
        if (spec === null) s.skip = true;
        else s.spec = spec;
      } catch (e: any) {
        s.error = String(e?.message ?? e);
      } finally {
        s.loading = false;
        progress.done++;
      }
    }
    progress.running = false;
  }

  return { slots, progress, run };
}
