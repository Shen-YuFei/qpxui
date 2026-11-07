<script setup lang="ts">
// The browse table's right-click menu for one cell: open the PSM's spectrum,
// expand the value, copy the value or the row, filter by the value.
import { computed } from "vue";
import { isStructured } from "../../lib/format";

const props = defineProps<{
  x: number;
  y: number;
  /** The table is a psm view that can open spectra. */
  psm: boolean;
  /** Why the row cannot open its spectrum, or "" when it can. */
  spectrumBlock: string;
  value: unknown;
  column: string;
  expanded: boolean;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "spectrum"): void;
  (e: "expand"): void;
  (e: "copyCell"): void;
  (e: "copyRow"): void;
  (e: "filter"): void;
}>();

const structured = computed(() => isStructured(props.value));
/** Only scalar cells can become a WHERE filter. */
const canFilter = computed(() => props.value == null || !isStructured(props.value));
</script>

<template>
  <div class="menu-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')"></div>
  <div class="menu" :style="{ left: x + 'px', top: y + 'px' }" role="menu">
    <button
      v-if="psm"
      role="menuitem"
      :disabled="!!spectrumBlock"
      :title="spectrumBlock || 'Open the annotated spectrum of this PSM'"
      @click="emit('spectrum')"
    >
      <span class="mi">📈</span> View spectrum
      <span v-if="spectrumBlock" class="why">{{ spectrumBlock }}</span>
    </button>
    <button v-if="structured" role="menuitem" @click="emit('expand')">
      <span class="mi">{{ expanded ? "▾" : "▸" }}</span>
      {{ expanded ? "Collapse cell" : "Expand cell" }}
    </button>
    <button role="menuitem" @click="emit('copyCell')"><span class="mi">⧉</span> Copy value</button>
    <button role="menuitem" @click="emit('copyRow')"><span class="mi">⧉</span> Copy row (JSON)</button>
    <button v-if="canFilter" role="menuitem" @click="emit('filter')">
      <span class="mi">⏷</span> Filter: {{ column }} = this
    </button>
  </div>
</template>

<style scoped>
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.menu {
  position: fixed;
  z-index: 41;
  min-width: 200px;
  max-width: 320px;
  padding: 4px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
}
.menu button {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  text-align: left;
  border: none;
  background: transparent;
  padding: 6px 10px;
  border-radius: 5px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
.menu button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.menu .mi {
  width: 16px;
  text-align: center;
}
.menu .why {
  flex-basis: 100%;
  padding-left: 22px;
  font-size: 10px;
  color: var(--muted, var(--text));
}
</style>
