<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ensureViewReady, runSql, type QueryResult } from "../lib/duck";
import { isStructured, formatCompact, scalarText } from "../lib/format";
import PTMTip from "./PTMTip.vue";
import StructuredView from "./StructuredView.vue";
import {
  hasInlineMods,
  inlineToSegments,
  isModificationsCol,
  isPeptideCol,
  modBadges,
  ptmColor,
  ptmTooltip,
  seqWithModsToSegments,
  shortCode,
  badgeTooltip,
  type PTMSeg,
} from "../lib/ptm";
import type { ViewInfo } from "../lib/api";

const props = defineProps<{ view: ViewInfo }>();

const tableName = ref("");
const sql = ref("");
const limit = 2000;
const results = ref<QueryResult>({ columns: [], rows: [], rowCount: 0, truncated: false });
const busy = ref(false);
const error = ref("");
const lastSql = ref("");
const expanded = ref<Record<string, boolean>>({});

const Examples = [
  "SELECT * FROM {table} LIMIT 50",
  "SELECT anchor_protein, COUNT(*) AS n FROM {table} WHERE anchor_protein IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
  "SELECT run_file_name, COUNT(*) AS n FROM {table} GROUP BY 1 ORDER BY 2 DESC",
  "SELECT charge, COUNT(*) AS n FROM {table} GROUP BY 1 ORDER BY 1",
];

onMounted(async () => {
  tableName.value = await ensureViewReady(props.view);
  sql.value = `SELECT * FROM "${tableName.value}" LIMIT 50`;
});

function substitute(text: string): string {
  return text.replace("{table}", `"${tableName.value}"`);
}

function insertExample(i: number) {
  sql.value = substitute(Examples[i]);
  run();
}

async function run() {
  busy.value = true;
  error.value = "";
  lastSql.value = sql.value;
  try {
    let body = sql.value.trim();
    if (!body) body = `SELECT * FROM "${tableName.value}"`;
    body = substitute(body);
    const final = /limit\s+\d+\s*$/i.test(body) ? body : `${body} LIMIT ${limit}`;
    results.value = await runSql(final);
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
const peptideMap = computed<Array<Map<number, PTMSeg[]>>>(() => {
  const cols = results.value.columns;
  return results.value.rows.map((row) => {
    const m = new Map<number, PTMSeg[]>();
    if (!cols || !cols.length) return m;
    const modsIdx = cols.findIndex((c) => isModificationsCol(c));
    cols.forEach((c, j) => {
      const v = row[j];
      if (typeof v !== "string" || !isPeptideCol(c)) return;
      let segs: PTMSeg[] | null = null;
      if (hasInlineMods(v)) {
        segs = inlineToSegments(v);
      } else if (modsIdx >= 0) {
        segs = seqWithModsToSegments(v, row[modsIdx]);
      }
      if (segs && segs.length) m.set(j, segs);
    });
    return m;
  });
});
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
              <!-- PTM-enhanced peptide / peptidoform sequence -->
              <template v-if="segsFor(i, j)">
                <span class="ptm-seq">
                  <template v-for="(seg, k) in segsFor(i, j)" :key="k">
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

              <!-- Structured `modifications` column -> colour-coded badges -->
              <template v-else-if="isModsCell(j) && isStructured(v)">
                <span class="ptm-badges">
                  <PTMTip
                    v-for="(b, k) in modBadges(v)"
                    :key="k"
                    :text="badgeTooltip(b)"
                  >
                    <span
                      class="ptm-badge"
                      :style="{ '--ptm': ptmColor(b.name, b.accession ?? undefined) }"
                    >
                      <span class="ptm-badge-dot"></span>{{ shortCode(b.name, b.accession ?? undefined) }}
                      <span v-if="b.terminal" class="ptm-badge-pos">{{ b.terminal === "N" ? "N-term" : "C-term" }}</span>
                      <span v-else-if="b.position" class="ptm-badge-pos">{{ b.position }}</span>
                    </span>
                  </PTMTip>
                </span>
              </template>

              <template v-else-if="isStructured(v)">
                <button class="cell-toggle" @click="toggle(i, j)">
                  {{ expanded[cellKey(i, j)] ? "▾" : "▸" }}
                </button>
                <StructuredView v-if="expanded[cellKey(i, j)]" :value="v" class="complex" />
                <span v-else class="compact mono" @click="toggle(i, j)">{{ formatCompact(v) }}</span>
              </template>
              <template v-else>{{ scalarText(v) }}</template>
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
.cell-toggle {
  border: none;
  background: transparent;
  padding: 0 4px 0 0;
  margin: 0;
  color: var(--accent);
  font-size: 10px;
}
.compact {
  color: var(--accent);
  cursor: pointer;
}
.complex {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  max-width: 480px;
  color: var(--text);
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  margin: 2px 0;
}
/* ---- PTM-aware peptide rendering ---- */
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
