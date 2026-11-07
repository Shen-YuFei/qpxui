<script setup lang="ts">
// Colour-coded peptide/peptidoform with PTM short codes and tooltips — the
// same rendering as the Browse table, packaged for report and search tables.
import { computed } from "vue";
import PTMSegs from "./PTMSegs.vue";
import { hasInlineMods, inlineToSegments, seqWithModsToSegments, type PTMSeg } from "../lib/ptm";

const props = defineProps<{ peptidoform?: string | null; sequence?: string | null; modifications?: unknown }>();

const segs = computed<PTMSeg[]>(() => {
  const pf = props.peptidoform ?? "";
  const seq = props.sequence || pf;
  const found =
    pf && hasInlineMods(pf)
      ? inlineToSegments(pf)
      : seq && props.modifications
        ? seqWithModsToSegments(seq, props.modifications)
        : null;
  // Unmodified: the plain text as one segment.
  return found?.length ? found : [{ text: pf || props.sequence || "", modified: false }];
});
</script>

<template>
  <PTMSegs :segs="segs" />
</template>
