<script setup lang="ts">
// A hover tooltip that always shows its full content, even inside scrollable
// tables. It is teleported to <body> with `position: fixed` and follows the
// mouse, clamping to the viewport so it is never clipped by an ancestor's
// `overflow: auto` (the common reason native `title` / absolutely-placed
// tooltips only showed part of a PTM).
import { ref } from "vue";

defineProps<{ text?: string }>();

const show = ref(false);
const x = ref(0);
const y = ref(0);

function onEnter() {
  show.value = true;
}
function onMove(e: MouseEvent) {
  const MARGIN = 10;
  // Place the box just below/right of the cursor…
  let nx = e.clientX + 14;
  let ny = e.clientY + 16;
  // …but clamp it inside the viewport so it can't run off screen.
  const approxW = 340;
  const approxH = 220;
  if (nx + approxW > window.innerWidth - MARGIN) {
    nx = Math.max(MARGIN, e.clientX - approxW - 12);
  }
  if (ny + approxH > window.innerHeight - MARGIN) {
    ny = Math.max(MARGIN, e.clientY - approxH - 12);
  }
  x.value = Math.round(nx);
  y.value = Math.round(ny);
}
function onLeave() {
  show.value = false;
}
</script>

<template>
  <span class="tip-wrap" @mouseenter="onEnter" @mousemove="onMove" @mouseleave="onLeave">
    <slot />
    <Teleport to="body">
      <span
        v-if="show && text"
        class="tip"
        role="tooltip"
        :style="{ left: x + 'px', top: y + 'px' }"
        >{{ text }}</span
      >
    </Teleport>
  </span>
</template>

<style scoped>
.tip-wrap {
  position: relative;
  display: inline-flex;
}
.tip {
  position: fixed;
  z-index: 9999;
  display: block;
  max-width: 340px;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 500;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.5;
  white-space: pre-line; /* keep the multi-line PTM body */
  color: #e2e8f0;
  background: rgba(15, 23, 42, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.45);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
</style>
