<script setup lang="ts">
import { computed } from "vue";
import type { DownloadProgress } from "../lib/api";
import { fmtBytes } from "../lib/format";
import { overall } from "../lib/progress";

const props = defineProps<{
  files: DownloadProgress[];
  cancelling: boolean;
  /** Status shown while files are transferring. */
  label: string;
}>();
defineEmits<{ cancel: [] }>();

const active = computed(() => props.files.filter((b) => b.phase === "downloading"));
const overallPct = computed(() => overall(props.files));

function pct(n: number): string {
  return `${Math.max(0, Math.min(100, n)).toFixed(0)}%`;
}
</script>

<template>
  <div class="progress-box">
    <div class="overall">
      <span class="muted">{{ cancelling ? "Cancelling…" : active.length ? label : "Checking sizes and disk space…" }}</span>
      <span class="right">
        <span class="muted">{{ overallPct !== null ? pct(overallPct) : "" }}</span>
        <button class="cancel" @click="$emit('cancel')" :disabled="cancelling">Cancel download</button>
      </span>
    </div>
    <div class="bar"><div class="fill" :style="{ width: pct(overallPct ?? 0) }"></div></div>
    <div v-for="b in active" :key="b.file" class="file-bar">
      <div class="file-row">
        <span class="mono file-name">{{ b.file }}</span>
        <span class="muted">{{ fmtBytes(b.done) }} / {{ b.total ? fmtBytes(b.total) : "…" }} · {{ pct(b.percent) }}</span>
      </div>
      <div class="bar"><div class="fill" :style="{ width: pct(b.percent) }"></div></div>
    </div>
  </div>
</template>

<style scoped>
.progress-box {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: var(--bg-soft);
}
.overall,
.file-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}
.right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.cancel {
  padding: 3px 12px;
  font-size: 12px;
  border-color: #d33;
  color: #d33;
}
.file-name {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar {
  height: 8px;
  background: var(--border);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 10px;
}
.fill {
  height: 100%;
  background: var(--accent);
  border-radius: 6px;
  transition: width 0.15s linear;
}
.file-bar:last-child .bar {
  margin-bottom: 0;
}
</style>
