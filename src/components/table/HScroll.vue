<script setup lang="ts">
// A horizontally scrolling box with an always-visible scrollbar: native
// scrollbars are overlays on macOS (hidden until you scroll), so the box gets
// its own track and thumb pinned under it.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const scroller = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
const sx = ref({ left: 0, client: 1, width: 1 });
const hasHScroll = computed(() => sx.value.width > sx.value.client + 1);
const thumbPct = computed(() => Math.max(4, (sx.value.client / sx.value.width) * 100));
const thumbLeft = computed(() => {
  const max = sx.value.width - sx.value.client;
  return max > 0 ? (sx.value.left / max) * (100 - thumbPct.value) : 0;
});
function syncScroll() {
  const s = scroller.value;
  if (s) sx.value = { left: s.scrollLeft, client: s.clientWidth, width: s.scrollWidth };
}
let drag: { x: number; left: number } | null = null;
function thumbDown(e: PointerEvent) {
  const s = scroller.value;
  if (!s) return;
  drag = { x: e.clientX, left: s.scrollLeft };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}
function thumbMove(e: PointerEvent) {
  const s = scroller.value;
  const t = track.value;
  if (!drag || !s || !t) return;
  const free = t.clientWidth * (1 - thumbPct.value / 100);
  if (free <= 0) return;
  s.scrollLeft = drag.left + ((e.clientX - drag.x) / free) * (s.scrollWidth - s.clientWidth);
}
function thumbUp() {
  drag = null;
}
function trackDown(e: PointerEvent) {
  const s = scroller.value;
  const t = track.value;
  if (!s || !t || e.target !== t) return;
  const r = t.getBoundingClientRect();
  const frac = (e.clientX - r.left) / r.width;
  s.scrollLeft = frac * s.scrollWidth - s.clientWidth / 2;
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  const el = scroller.value!;
  ro = new ResizeObserver(syncScroll);
  ro.observe(el);
  const tbl = el.querySelector("table");
  if (tbl) ro.observe(tbl);
  syncScroll();
});
onBeforeUnmount(() => ro?.disconnect());

defineExpose({ el: scroller, sync: syncScroll });
</script>

<template>
  <div ref="scroller" class="scroll" @scroll="syncScroll"><slot /></div>
  <div v-if="hasHScroll" ref="track" class="hbar" title="Drag to scroll columns" @pointerdown="trackDown">
    <div
      class="hthumb"
      :style="{ width: thumbPct + '%', left: thumbLeft + '%' }"
      @pointerdown.stop="thumbDown"
      @pointermove="thumbMove"
      @pointerup="thumbUp"
      @pointercancel="thumbUp"
    ></div>
  </div>
</template>

<style scoped>
.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.scroll::-webkit-scrollbar:horizontal {
  display: none;
  height: 0;
}
.hbar {
  position: relative;
  flex: none;
  height: 14px;
  background: var(--bg-soft);
  border-top: 1px solid var(--border);
  cursor: pointer;
}
.hthumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  cursor: grab;
  touch-action: none;
}
.hthumb:hover,
.hthumb:active {
  background: var(--accent);
}
</style>
