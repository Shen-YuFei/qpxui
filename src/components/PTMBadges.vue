<script setup lang="ts">
// The structured `modifications` column as colour-coded pills.
import PTMTip from "./PTMTip.vue";
import { badgeTooltip, modBadges, ptmColor, shortCode } from "../lib/ptm";

defineProps<{ mods: unknown }>();
</script>

<template>
  <span class="ptm-badges">
    <PTMTip v-for="(b, k) in modBadges(mods)" :key="k" :text="badgeTooltip(b)">
      <span class="ptm-badge" :style="{ '--ptm': ptmColor(b.name, b.accession ?? undefined) }">
        <span class="ptm-badge-dot"></span>{{ shortCode(b.name, b.accession ?? undefined) }}
        <span v-if="b.terminal" class="ptm-badge-pos">{{ b.terminal === "N" ? "N-term" : "C-term" }}</span>
        <span v-else-if="b.position" class="ptm-badge-pos">{{ b.position }}</span>
      </span>
    </PTMTip>
  </span>
</template>

<style scoped>
.ptm-badges {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
/* A tag: text ink on a light tint, the modification colour in the dot. */
.ptm-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 0 6px;
  border-radius: 3px;
  color: var(--text-dim);
  background: color-mix(in srgb, var(--ptm) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--ptm) 35%, transparent);
  cursor: help;
  line-height: 1.5;
}
.ptm-badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ptm);
}
.ptm-badge-pos {
  color: var(--muted);
}
</style>
