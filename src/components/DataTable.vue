<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ensureViewReady, runSql, type QueryResult } from "../lib/duck";
import { isStructured, formatCompact, scalarText } from "../lib/format";
import type { ViewInfo } from "../lib/api";
import PTMTip from "./PTMTip.vue";
import StructuredView from "./StructuredView.vue";
import {
  badgeTooltip,
  hasInlineMods,
  inlineToSegments,
  isModificationsCol,
  isPeptideCol,
  modBadges,
  ptmColor,
  ptmTooltip,
  seqWithModsToSegments,
  shortCode,
  type PTMSeg,
} from "../lib/ptm";

const props = defineProps<{ view: ViewInfo }>();
const table = ref("");
const result = ref<QueryResult>({ columns: [], rows: [], rowCount: 0, truncated: false });
const total = ref(0);
const page = ref(0);
const pageSize = 500;
const limit = ref(500);
const where = ref("");
const sortCol = ref<string | null>(null);
const sortDir = ref<"ASC" | "DESC">("ASC");
const loading = ref(false);
const error = ref("");
const expanded = ref<Record<string, boolean>>({});
// Toggle rich PTM rendering on/off (default on). When off, peptide/peptidoform
// cells fall back to the plain scalar/structured rendering.
const ptmOn = ref(true);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    table.value = await ensureViewReady(props.view);
    const c = await runSql(`SELECT COUNT(*) AS n FROM "${table.value}"`);
    total.value = Number((c.rows[0]?.[0] as any) ?? 0);

    const whereClause = where.value.trim() ? ` WHERE ${where.value.trim()}` : "";
    const orderClause = sortCol.value ? ` ORDER BY "${sortCol.value}" ${sortDir.value}` : "";
    const off = page.value * pageSize;
    result.value = await runSql(
      `SELECT * FROM "${table.value}"${whereClause}${orderClause} LIMIT ${limit.value} OFFSET ${off}`
    );
  } catch (e: any) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => [props.view.path, where.value], () => {
  page.value = 0;
  load();
});

const totalPages = computed(() => Math.max(0, Math.ceil(total.value / pageSize)));
const shown = computed(() => result.value.rows.length);

function prev() {
  if (page.value > 0) {
    page.value--;
    load();
  }
}
function next() {
  if (page.value < totalPages.value - 1) {
    page.value++;
    load();
  }
}
function toggleSort(col: string) {
  if (sortCol.value === col) sortDir.value = sortDir.value === "ASC" ? "DESC" : "ASC";
  else {
    sortCol.value = col;
    sortDir.value = "ASC";
  }
  load();
}
function cellKey(i: number, j: number): string {
  return `${i}:${j}`;
}
function toggle(i: number, j: number) {
  const k = cellKey(i, j);
  expanded.value[k] = !expanded.value[k];
}

// ---- PTM-aware peptide rendering ----
// Per row, a map of cell column index -> peptide tokens (for sequence columns),
// built from the inline `peptidoform` string or from `sequence` + `modifications`.
const peptideMap = computed<Array<Map<number, PTMSeg[]>>>(() => {
  const cols = result.value.columns;
  return result.value.rows.map((row) => {
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
  return isModificationsCol(result.value.columns[j] ?? "");
}
</script>

<template>
  <div class="table-wrap">
    <div class="toolbar">
      <div class="filters">
        <input v-model="where" placeholder="WHERE clause, e.g. charge >= 3" class="mono where" />
        <button @click="page = 0; load()" :disabled="loading">Apply</button>
      </div>
      <label class="ptm-toggle" title="Render peptide PTMs with colour, short codes and mass/accession tooltips">
        <input type="checkbox" v-model="ptmOn" />
        <span>PTMs</span>
      </label>
      <div class="muted info">
        {{ total.toLocaleString() }} rows · showing {{ shown.toLocaleString() }}
        <span v-if="result.truncated">(truncated)</span>
      </div>
      <div class="pager">
        <button :disabled="page === 0 || loading" @click="prev">‹ prev</button>
        <span class="muted">{{ page + 1 }} / {{ Math.max(1, totalPages) }}</span>
        <button :disabled="page >= totalPages - 1 || loading" @click="next">next ›</button>
      </div>
    </div>

    <div v-if="error" class="error pad">⚠ {{ error }}</div>
    <div v-else-if="loading" class="pad muted">Querying… <span class="spinner"></span></div>
    <div class="scroll" v-else>
      <table>
        <thead>
          <tr>
            <th v-for="c in result.columns" :key="c" class="mono" @click="toggleSort(c)">
              {{ c }}
              <span class="sort" v-if="sortCol === c">{{ sortDir === "ASC" ? "▲" : "▼" }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in result.rows" :key="i">
            <td
              v-for="(v, j) in row"
              :key="j"
              :class="{ num: typeof v === 'number', 'mono': typeof v === 'string' }"
            >
              <!-- PTM-enhanced peptide / peptidoform sequence -->
              <template v-if="ptmOn && segsFor(i, j)">
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
              <template v-else-if="ptmOn && isModsCell(j) && isStructured(v)">
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

              <!-- Other structured values (expandable JSON) -->
              <template v-else-if="isStructured(v)">
                <button
                  class="cell-toggle"
                  :title="expanded[cellKey(i, j)] ? 'Collapse' : 'Expand'"
                  @click="toggle(i, j)"
                >
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
.table-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.filters {
  display: flex;
  gap: 8px;
  flex: 1;
}
.where {
  flex: 1;
  font-size: 12px;
}
.info {
  font-size: 12px;
}
.ptm-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted, var(--text));
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.ptm-toggle input {
  accent-color: var(--accent);
  cursor: pointer;
}
.pager {
  display: flex;
  align-items: center;
  gap: 8px;
}
.scroll {
  flex: 1;
  overflow: auto;
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
  cursor: pointer;
  user-select: none;
  z-index: 1;
}
th:hover {
  color: var(--accent);
}
.sort {
  font-size: 9px;
}
td.num {
  font-variant-numeric: tabular-nums;
}
.cell-toggle {
  border: none;
  background: transparent;
  padding: 0 4px 0 0;
  margin: 0;
  color: var(--accent);
  font-size: 10px;
  vertical-align: baseline;
}
.compact {
  color: var(--accent);
  cursor: pointer;
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
.pad {
  padding: 18px;
}
</style>
