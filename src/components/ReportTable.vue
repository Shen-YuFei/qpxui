<script setup lang="ts">
import { computed, ref } from "vue";
import { toCsv } from "../lib/charts";
import { saveText } from "../lib/export";
import type { Column } from "../lib/report";
import { listText } from "../lib/format";

type Row = Record<string, any>;


const props = defineProps<{
  columns: Column[];
  rows: Row[];
  /** Row key field, for highlighting the selected row. */
  rowKey?: string;
  selected?: string | null;
  fileName?: string;
  maxHeight?: string;
  clickable?: boolean;
}>();
const emit = defineEmits<{ (e: "row", row: Row): void }>();

// Hide columns that are empty in every row (e.g. gene names missing from the file).
const shownCols = computed(() =>
  props.rows.length
    ? props.columns.filter((c) =>
        props.rows.some((r) => {
          const v = r[c.key];
          return v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
        })
      )
    : props.columns
);

const sortKey = ref<string | null>(null);
const sortDir = ref<1 | -1>(1);

const sorted = computed(() => {
  if (!sortKey.value) return props.rows;
  const k = sortKey.value;
  const d = sortDir.value;
  return [...props.rows].sort((a, b) => {
    const x = a[k];
    const y = b[k];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * d;
    return String(listText(x)).localeCompare(String(listText(y))) * d;
  });
});

function sortBy(k: string) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 1 ? -1 : 1;
  else {
    sortKey.value = k;
    const col = props.columns.find((c) => c.key === k);
    sortDir.value = col?.num ? -1 : 1;
  }
}

function text(c: Column, row: Row): string {
  const v = row[c.key];
  if (c.fmt) return c.fmt(v, row);
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toPrecision(4);
  if (Array.isArray(v)) return listText(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

async function exportCsv() {
  const header = shownCols.value.map((c) => c.label);
  const rows = sorted.value.map((r) =>
    shownCols.value.map((c) => {
      const v = r[c.key];
      return Array.isArray(v) ? v.join(";") : v;
    })
  );
  await saveText(props.fileName ?? "table", toCsv(header, rows));
}

defineExpose({ exportCsv });
</script>

<template>
  <div class="rt" :style="{ maxHeight: maxHeight ?? 'none' }">
    <table>
      <thead>
        <tr>
          <th
            v-for="c in shownCols"
            :key="c.key"
            :class="{ num: c.num }"
            :title="c.title ?? 'Click to sort'"
            @click="sortBy(c.key)"
          >
            {{ c.label }}<span v-if="sortKey === c.key" class="sort">{{ sortDir === 1 ? "▲" : "▼" }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(r, i) in sorted"
          :key="rowKey ? String(r[rowKey]) + i : i"
          :class="{ sel: rowKey && selected !== undefined && selected !== null && r[rowKey] === selected, click: clickable }"
          @click="emit('row', r)"
        >
          <td v-for="c in shownCols" :key="c.key" :class="{ num: c.num }">
            <slot :name="`cell-${c.key}`" :row="r" :value="r[c.key]">{{ text(c, r) }}</slot>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="shownCols.length" class="muted empty">No rows</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.rt {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  font-size: 12px;
}
th {
  position: sticky;
  top: 0;
  background: var(--bg-soft);
  cursor: pointer;
  user-select: none;
  z-index: 1;
  font-weight: 600;
}
th:hover {
  color: var(--accent);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.sort {
  font-size: 9px;
  margin-left: 3px;
}
tr.click {
  cursor: pointer;
}
tr.click:hover td {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}
tr.sel td {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
.empty {
  text-align: center;
  padding: 16px;
}
</style>
