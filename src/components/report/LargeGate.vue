<script setup lang="ts">
import { fmtBytes } from "../../lib/format";

defineProps<{ bytes: number; size: number; what: string }>();
defineEmits<{ go: [] }>();
</script>

<template>
  <div class="gate">
    <p>
      This dataset is streamed and large ({{ fmtBytes(size) }}). {{ what }} reads whole columns of it,
      at least <b>{{ fmtBytes(bytes) }}</b> over the network (more when several charts read the same columns), so it is not computed automatically.
    </p>
    <button class="primary" @click="$emit('go')">Compute (≥ {{ fmtBytes(bytes) }})</button>
  </div>
</template>

<style scoped>
/* A callout with a brand rule, like the citation box. */
.gate {
  border-left: 3px solid var(--accent);
  background: var(--bg-alt);
  border-radius: 0 6px 6px 0;
  padding: 14px 16px;
  font-size: 13px;
  margin-bottom: 12px;
}
.gate p {
  margin: 0 0 10px;
}
</style>
