<script setup lang="ts">
// Sequence coverage of the spectrum: the residues, with the matched b ions
// (blue, below) and y ions (red, above) marked at each cleavage.
import type { CoverageMark } from "../../lib/fragments";

defineProps<{ marks: CoverageMark[] }>();
</script>

<template>
  <div class="coverage mono" title="Matched b (blue, below) and y (red, above) ions without neutral losses">
    <template v-for="(c, k) in marks" :key="k">
      <span class="aa" :class="{ mod: c.mod }">{{ c.aa }}</span>
      <span v-if="k < marks.length - 1" class="cut" :class="{ b: c.b, y: c.y }"></span>
    </template>
  </div>
</template>

<style scoped>
.coverage {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  padding: 10px 0 6px;
  font-size: 17px;
  row-gap: 14px;
}
.coverage .aa {
  padding: 0 1px;
}
.coverage .aa.mod {
  color: var(--accent);
  font-weight: 700;
}
.cut {
  position: relative;
  width: 7px;
  height: 1.5em;
}
.cut.y::before {
  content: "";
  position: absolute;
  left: 3px;
  top: -6px;
  height: calc(50% + 6px);
  width: 6px;
  border-left: 2px solid #ef4444;
  border-top: 2px solid #ef4444;
}
.cut.b::after {
  content: "";
  position: absolute;
  left: -3px;
  bottom: -6px;
  height: calc(50% + 6px);
  width: 6px;
  border-right: 2px solid #3b82f6;
  border-bottom: 2px solid #3b82f6;
}
</style>
