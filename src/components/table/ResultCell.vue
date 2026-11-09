<script setup lang="ts">
// The content of one result-table cell: PTM-coloured peptides, modification
// badges, expandable structured values and (in the browse table) peak arrays
// as "N peaks".
import { formatCompact, isStructured, peakSummary, scalarText } from "../../lib/format";
import type { PTMSeg } from "../../lib/ptm";
import PTMBadges from "../PTMBadges.vue";
import PTMSegs from "../PTMSegs.vue";
import StructuredView from "../StructuredView.vue";

withDefaults(
  defineProps<{
    value: unknown;
    expanded: boolean;
    /** Peptide tokens, when the cell is a peptide sequence. */
    segs?: PTMSeg[];
    /** The cell is in a `modifications` column. */
    mods?: boolean;
    /** Render PTMs: coloured peptides and modification badges. */
    ptm?: boolean;
    /** The cell is a peak array. */
    peak?: boolean;
    /** Tooltips on the expand toggle. */
    toggleTitles?: boolean;
  }>(),
  { ptm: true }
);
const emit = defineEmits<{ (e: "toggle"): void }>();
</script>

<template>
  <!-- Peak arrays: "N peaks" summary, click to expand -->
  <span v-if="peak && !expanded" class="peaks" :title="Array.isArray(value) ? formatCompact(value) : 'null'" @click="Array.isArray(value) && emit('toggle')">
    {{ peakSummary(value) }}<template v-if="Array.isArray(value) && value.length"> ▸</template>
  </span>

  <!-- PTM-enhanced peptide / peptidoform sequence -->
  <PTMSegs v-else-if="ptm && segs" :segs="segs" />

  <!-- Structured `modifications` column -> colour-coded badges -->
  <PTMBadges v-else-if="ptm && mods && isStructured(value)" :mods="value" />

  <!-- Other structured values (expandable JSON) -->
  <template v-else-if="isStructured(value)">
    <button class="cell-toggle" :title="toggleTitles ? (expanded ? 'Collapse' : 'Expand') : undefined" @click="emit('toggle')">
      {{ expanded ? "▾" : "▸" }}
    </button>
    <StructuredView v-if="expanded" :value="value" class="complex" />
    <span v-else class="compact mono" @click="emit('toggle')">{{ formatCompact(value) }}</span>
  </template>
  <template v-else>{{ scalarText(value) }}</template>
</template>

<style scoped>
.peaks {
  color: var(--accent);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.cell-toggle {
  border: none;
  background: transparent;
  padding: 0 4px 0 0;
  margin: 0;
  color: var(--accent);
  font-size: 10px;
  vertical-align: baseline;
}
.compact {
  color: var(--accent);
  cursor: pointer;
}
.complex {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.45;
  max-width: 480px;
  color: var(--text);
  background: var(--bg-alt);
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 6px 8px;
  margin: 2px 0;
}
</style>
