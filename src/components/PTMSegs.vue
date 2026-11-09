<script setup lang="ts">
// Colour-coded residues with PTM short codes and tooltips, shared by the
// tables and PeptideSeq.
import PTMTip from "./PTMTip.vue";
import { ptmColor, ptmTooltip, shortCode, type PTMSeg } from "../lib/ptm";

defineProps<{ segs: PTMSeg[] }>();
</script>

<template>
  <span class="ptm-seq">
    <template v-for="(seg, k) in segs" :key="k">
      <span v-if="!seg.modified && !seg.terminal" class="ptm-aa">{{ seg.text }}</span>
      <PTMTip v-else :text="ptmTooltip(seg)">
        <mark
          v-if="seg.terminal"
          class="ptm-mod ptm-term"
          :style="{ '--ptm': ptmColor(seg.modName, seg.accession) }"
        >
          <span class="ptm-term-tag">{{ seg.terminal === "N" ? "N" : "C" }}</span>{{ shortCode(seg.modName, seg.accession) }}
        </mark>
        <mark
          v-else
          class="ptm-mod"
          :style="{ '--ptm': ptmColor(seg.modName, seg.accession) }"
        >
          {{ seg.text }}<sup class="ptm-code">{{ shortCode(seg.modName, seg.accession) }}</sup>
        </mark>
      </PTMTip>
    </template>
  </span>
</template>

<style scoped>
.ptm-seq {
  font-family: var(--mono);
  white-space: nowrap;
}
.ptm-aa {
  color: var(--text);
}
/* As on the portal: the residue stays in text ink on a tint of the
   modification colour, with a bar of the full colour underneath. */
.ptm-mod {
  color: var(--text);
  background: color-mix(in srgb, var(--ptm) 22%, transparent);
  box-shadow: inset 0 -2px 0 var(--ptm);
  border-radius: 2px;
  padding: 0 1px;
  font-weight: 600;
  cursor: help;
}
.ptm-code {
  font-size: 8px;
  font-weight: 500;
  margin-left: 1px;
  color: var(--muted);
}
.ptm-term {
  padding: 0 4px;
}
.ptm-term-tag {
  font-size: 8px;
  margin-right: 2px;
  font-weight: 500;
  color: var(--muted);
}
</style>
