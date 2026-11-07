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
          :style="{ '--ptm': ptmColor(seg.modName, seg.accession), color: ptmColor(seg.modName, seg.accession) }"
        >
          <span class="ptm-term-tag">{{ seg.terminal === "N" ? "N" : "C" }}</span>{{ shortCode(seg.modName, seg.accession) }}
        </mark>
        <mark
          v-else
          class="ptm-mod"
          :style="{ '--ptm': ptmColor(seg.modName, seg.accession), color: ptmColor(seg.modName, seg.accession) }"
        >
          {{ seg.text }}<sup class="ptm-code">{{ shortCode(seg.modName, seg.accession) }}</sup>
        </mark>
      </PTMTip>
    </template>
  </span>
</template>

<style scoped>
.ptm-seq {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap;
}
.ptm-aa {
  color: var(--text);
}
.ptm-mod {
  background: color-mix(in srgb, var(--ptm) 28%, transparent);
  border-radius: 4px;
  padding: 0 1px;
  font-weight: 700;
  cursor: help;
}
.ptm-code {
  font-size: 8px;
  font-weight: 700;
  margin-left: 1px;
  color: var(--ptm);
}
.ptm-term {
  padding: 0 4px;
  font-weight: 700;
}
.ptm-term-tag {
  opacity: 0.7;
  font-size: 8px;
  margin-right: 2px;
  font-weight: 700;
}
</style>
