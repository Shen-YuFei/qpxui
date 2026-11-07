<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { ensureViewReady, type QueryResult } from "../lib/duck";
import { QUERY_EXAMPLES as Examples, QUERY_LIMIT as limit, runQuery, substituteTable } from "../lib/queries/sqlConsole";
import ResultCell from "./table/ResultCell.vue";
import { isModificationsCol, peptideCells, type PTMSeg } from "../lib/ptm";
import type { ViewInfo } from "../lib/api";

const props = defineProps<{ view: ViewInfo }>();

const tableName = ref("");
const sql = ref("");
// Replaced as a whole on each run: no deep proxies over the rows.
const results = shallowRef<QueryResult>({ columns: [], rows: [], rowCount: 0, truncated: false });
const busy = ref(false);
const error = ref("");
const lastSql = ref("");
const expanded = ref<Record<string, boolean>>({});

onMounted(async () => {
  tableName.value = await ensureViewReady(props.view);
  sql.value = substituteTable(Examples[0], tableName.value);
});

function insertExample(i: number) {
  sql.value = substituteTable(Examples[i], tableName.value);
  run();
}

async function run() {
  busy.value = true;
  error.value = "";
  lastSql.value = sql.value;
  try {
    results.value = await runQuery(sql.value, tableName.value);
  } catch (e: any) {
    error.value = String(e);
    results.value = { columns: [], rows: [], rowCount: 0, truncated: false };
  } finally {
    busy.value = false;
  }
}

function cellKey(i: number, j: number): string {
  return `${i}:${j}`;
}
function toggle(i: number, j: number) {
  const k = cellKey(i, j);
  expanded.value[k] = !expanded.value[k];
}

// ---- PTM-aware peptide rendering (same logic as the Browse table) ----
const peptideMap = computed(() => peptideCells(results.value.columns, results.value.rows));
function segsFor(i: number, j: number): PTMSeg[] | undefined {
  return peptideMap.value[i]?.get(j);
}
function isModsCell(j: number): boolean {
  return isModificationsCol(results.value.columns[j] ?? "");
}
</script>

<template>
  <div class="query">
    <div class="bar">
      <div class="examples">
        <span class="muted">Quick:</span>
        <button v-for="(ex, i) in Examples" :key="i" @click="insertExample(i)">#{{ i + 1 }}</button>
      </div>
      <button class="primary" @click="run" :disabled="busy || !tableName">
        {{ busy ? "Running…" : "Run SQL" }}
      </button>
    </div>

    <textarea
      v-model="sql"
      class="mono editor"
      placeholder='Type SQL. The view is available as a DuckDB table, e.g.  SELECT * FROM feature WHERE charge >= 3'
      spellcheck="false"
    ></textarea>

    <div class="meta">
      <span v-if="lastSql" class="muted">{{ results.rowCount.toLocaleString() }} row(s) <span v-if="results.truncated">(capped at {{ limit }})</span></span>
      <span v-else class="muted">Results appear here. Quick examples are numbered above.</span>
      <span v-if="error" class="error">⚠ {{ error }}</span>
    </div>

    <div class="scroll" v-if="results.columns.length">
      <table>
        <thead>
          <tr>
            <th v-for="c in results.columns" :key="c" class="mono">{{ c }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in results.rows" :key="i">
            <td v-for="(v, j) in row" :key="j" :class="{ 'mono': typeof v === 'string' }">
              <ResultCell :value="v" :expanded="!!expanded[cellKey(i, j)]" :segs="segsFor(i, j)" :mods="isModsCell(j)" @toggle="toggle(i, j)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.query {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.examples {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.examples button {
  padding: 4px 10px;
  font-size: 12px;
}
.editor {
  width: 100%;
  min-height: 150px;
  resize: vertical;
  font-size: 13px;
  line-height: 1.5;
  background: var(--bg-panel);
}
.meta {
  font-size: 12px;
  min-height: 18px;
}
.scroll {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
}
th,
td {
  text-align: left;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  font-size: 12px;
}
th {
  position: sticky;
  top: 0;
  background: var(--bg-soft);
  z-index: 1;
}
</style>
