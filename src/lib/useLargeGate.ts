import { reactive } from "vue";
import { largeViews, scanBytes, type TableRef } from "./report";

export interface GateNeed {
  ref: TableRef | undefined;
  /** Columns the tab's queries read from this view. */
  cols: string[];
}

/** Holds back whole-file scans on large streamed views until the user asks.
 * `check` reads only parquet footers; when a view is large it sets `blocked`
 * and the estimated bytes, and the tab shows a button that calls `release`. */
export function useLargeGate() {
  const gate = reactive({ checking: true, blocked: false, bytes: 0, size: 0 });
  let resume: (() => void) | null = null;

  async function check(needs: GateNeed[], go: () => void): Promise<void> {
    gate.checking = true;
    const big = await largeViews(needs.map((n) => n.ref));
    gate.checking = false;
    if (!big.length) {
      go();
      return;
    }
    gate.bytes = big.reduce((sum, b) => {
      const need = needs.find((n) => n.ref === b.ref)!;
      return sum + scanBytes(b.scale, need.cols.filter((c) => b.ref.cols.has(c)));
    }, 0);
    gate.size = big.reduce((sum, b) => sum + b.scale.bytes, 0);
    gate.blocked = true;
    resume = go;
  }

  function release() {
    gate.blocked = false;
    const r = resume;
    resume = null;
    r?.();
  }

  return { gate, check, release };
}
