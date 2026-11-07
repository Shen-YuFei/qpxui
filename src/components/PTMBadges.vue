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
.ptm-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--ptm);
  background: color-mix(in srgb, var(--ptm) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--ptm) 45%, transparent);
  cursor: help;
  line-height: 1.4;
}
.ptm-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ptm);
}
.ptm-badge-pos {
  opacity: 0.75;
}
</style>
