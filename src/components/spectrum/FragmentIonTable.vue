<script setup lang="ts">
// Fragment ion table (USI viewer / Lorikeet style): per residue, the m/z of
// the b ion ending and the y ion starting there at each charge, matched ions
// highlighted.
import type { IonRow } from "../../lib/spectrumSummary";

defineProps<{ charges: number[]; rows: IonRow[] }>();
</script>

<template>
  <details class="ions" open>
    <summary>Fragment ions</summary>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th v-for="z in charges" :key="'b' + z" class="bh">b{{ z > 1 ? "+".repeat(z) : "" }}</th>
            <th>AA</th>
            <th v-for="z in charges" :key="'y' + z" class="yh">y{{ z > 1 ? "+".repeat(z) : "" }}</th>
            <th>#</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.bNum">
            <td class="muted">{{ r.bNum }}</td>
            <td v-for="(c, j) in r.b" :key="'b' + j" class="num" :class="{ bhit: c?.hit }">{{ c?.mz != null ? c.mz.toFixed(4) : "" }}</td>
            <td class="aa" :title="r.mod">{{ r.aa }}<sup v-if="r.mod">•</sup></td>
            <td v-for="(c, j) in r.y" :key="'y' + j" class="num" :class="{ yhit: c?.hit }">{{ c?.mz != null ? c.mz.toFixed(4) : "" }}</td>
            <td class="muted">{{ r.yNum }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>

<style scoped>
.ions summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-dim);
}
.tablewrap {
  max-height: 280px;
  overflow: auto;
  margin-top: 6px;
}
table {
  border-collapse: collapse;
  font-size: 12px;
  margin: 0 auto;
}
th,
td {
  padding: 2px 10px;
  text-align: center;
  border-bottom: 1px solid var(--border);
}
td.num {
  width: 64px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: right;
}
td.aa {
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
th.bh {
  color: #3b82f6;
}
th.yh {
  color: #ef4444;
}
td.bhit {
  background: rgba(59, 130, 246, 0.22);
  color: var(--text);
  font-weight: 600;
}
td.yhit {
  background: rgba(239, 68, 68, 0.22);
  color: var(--text);
  font-weight: 600;
}
</style>
