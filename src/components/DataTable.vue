<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { countRows, describeTable, ensureViewReady, type QueryResult } from "../lib/duck";
import { isStructured, toJson } from "../lib/format";
import type { ViewInfo } from "../lib/api";
import type { TableRef } from "../lib/report";
import { viewScale } from "../lib/report";
import { cellFilter, isPeakColumn, tablePage } from "../lib/queries/table";
import { state } from "../store";
import ResultCell from "./table/ResultCell.vue";
import CellMenu from "./table/CellMenu.vue";
import HScroll from "./table/HScroll.vue";
import SpectrumViewer from "./SpectrumViewer.vue";
import { psmKeyOf, whyNoSpectrum, type PsmKey } from "../lib/queries/spectrum";
import { isModificationsCol, peptideCells, type PTMSeg } from "../lib/ptm";

const props = defineProps<{ view: ViewInfo }>();
const table = ref("");
// Replaced as a whole on each load: no deep proxies over rows and peak arrays.
const result = shallowRef<QueryResult>({ columns: [], rows: [], rowCount: 0, truncated: false });
const total = ref(0);
const page = ref(0);
const pageSize = 500;
const where = ref("");
const sortCol = ref<string | null>(null);
const sortDir = ref<"ASC" | "DESC">("ASC");
const loading = ref(false);
const error = ref("");
const expanded = ref<Record<string, boolean>>({});
// Toggle rich PTM rendering on/off (default on). When off, peptide/peptidoform
// cells fall back to the plain scalar/structured rendering.
const ptmOn = ref(true);

// Per-peak arrays of a psm view: shown as "N peaks", after the other columns.
const showPeaks = ref(true);
// Large streamed views start with peaks hidden: a page with peaks reads a
// whole row group of peak arrays (often 100+ MB).
const largeRemote = ref(false);
const colTypes = ref<Record<string, string>>({});
const colNames = ref<string[]>([]);
const hasPeakCols = computed(() => colNames.value.some(isPeakColumn));

let loadSeq = 0;
async function load() {
  const id = ++loadSeq;
  closeMenu();
  loading.value = true;
  error.value = "";
  try {
    table.value = await ensureViewReady(props.view);
    if (!colNames.value.length) {
      const desc = await describeTable(table.value);
      colNames.value = desc.map((d) => d.name);
      colTypes.value = Object.fromEntries(desc.map((d) => [d.name.toLowerCase(), d.type]));
      if (hasPeakCols.value && /^(s3|https?):\/\//.test(props.view.path)) {
        largeRemote.value = (await viewScale({ view: props.view, table: table.value })).large;
        if (largeRemote.value) {
          showPeaks.value = false;
          return; // the showPeaks watcher reloads without the peak columns
        }
      }
    }
    const n = await countRows(table.value);
    if (id !== loadSeq) return;
    total.value = n;

    const res = await tablePage({
      table: table.value,
      cols: colNames.value,
      peaks: showPeaks.value,
      where: where.value,
      sort: sortCol.value ? { col: sortCol.value, dir: sortDir.value } : null,
      page: page.value,
      pageSize,
    });
    if (id === loadSeq) result.value = res;
  } catch (e: any) {
    if (id === loadSeq) error.value = String(e);
  } finally {
    if (id === loadSeq) loading.value = false;
  }
}

onMounted(load);
watch(showPeaks, () => load());

function isPeakCol(j: number): boolean {
  return isPeakColumn(result.value.columns[j] ?? "");
}

// ---- Right-click cell menu ----
const menu = ref<{ x: number; y: number; i: number; j: number } | null>(null);
const msg = ref("");
const spectrum = ref<PsmKey | null>(null);

const psmRef = computed<TableRef | null>(() => {
  if (props.view.view !== "psm") return null;
  const cols = new Set(Object.keys(colTypes.value));
  if (!cols.has("peptidoform") || !cols.has("mz_array") || !cols.has("intensity_array")) return null;
  return { view: props.view, table: table.value, cols, types: colTypes.value, seq: "sequence" };
});

/** Why the selected row cannot open the spectrum viewer, or "" when it can. */
const spectrumBlock = computed<string>(() => {
  if (!menu.value || !psmRef.value) return "Spectra need a psm view with peptidoform and peak arrays";
  return whyNoSpectrum(result.value.columns, result.value.rows[menu.value.i], showPeaks.value);
});

function openMenu(ev: MouseEvent, i: number, j: number) {
  const w = 220;
  const h = 170;
  menu.value = {
    x: Math.min(ev.clientX, window.innerWidth - w - 8),
    y: Math.min(ev.clientY, window.innerHeight - h - 8),
    i,
    j,
  };
}
function closeMenu() {
  menu.value = null;
}

function viewSpectrum() {
  const m = menu.value;
  const blocked = spectrumBlock.value;
  closeMenu();
  if (!m || blocked) return;
  spectrum.value = psmKeyOf(result.value.columns, result.value.rows[m.i]);
}

function cellText(v: unknown): string {
  return isStructured(v) ? toJson(v) : v == null ? "" : String(v);
}
async function copyCell() {
  const m = menu.value;
  closeMenu();
  if (!m) return;
  await copy(cellText(result.value.rows[m.i]?.[m.j]), "Value copied");
}
async function copyRow() {
  const m = menu.value;
  closeMenu();
  if (!m) return;
  const cols = result.value.columns;
  const row = result.value.rows[m.i] ?? [];
  await copy(toJson(Object.fromEntries(cols.map((c, j) => [c, row[j]])), 2), "Row copied as JSON");
}
async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    flash(ok);
  } catch {
    flash("Copy failed");
  }
}
function flash(s: string) {
  msg.value = s;
  setTimeout(() => {
    if (msg.value === s) msg.value = "";
  }, 1800);
}

function filterBy() {
  const m = menu.value;
  closeMenu();
  if (!m) return;
  const cond = cellFilter(result.value.columns[m.j], result.value.rows[m.i]?.[m.j]);
  where.value = where.value.trim() ? `${where.value.trim()} AND ${cond}` : cond;
}
function expandCell() {
  const m = menu.value;
  closeMenu();
  if (m) toggle(m.i, m.j);
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") closeMenu();
}

// The table's scroll box, with its own horizontal scrollbar.
const hs = ref<InstanceType<typeof HScroll> | null>(null);

/** Scroll a column into view (and flash its header). */
const jumpCol = ref("");
function jumpTo(col: string) {
  jumpCol.value = "";
  const s = hs.value?.el;
  const j = result.value.columns.indexOf(col);
  const th = s?.querySelectorAll("thead th")[j] as HTMLElement | undefined;
  if (!s || !th) return;
  s.scrollLeft = th.offsetLeft - 24;
  th.classList.add("flash-col");
  setTimeout(() => th.classList.remove("flash-col"), 1200);
}

watch(result, () => requestAnimationFrame(() => hs.value?.sync()));

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("blur", closeMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("blur", closeMenu);
});
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
const peptideMap = computed(() => peptideCells(result.value.columns, result.value.rows));

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
      <label
        v-if="hasPeakCols"
        class="ptm-toggle"
        :title="largeRemote
          ? 'Large streamed view: peak arrays are hidden because a page with them reads a whole row group of peaks (often 100+ MB). Right-click a PSM to open its spectrum.'
          : 'Peak arrays (mz_array, intensity_array, …) are shown last as \'N peaks\'. Untick to hide them and skip reading them.'"
      >
        <input type="checkbox" v-model="showPeaks" />
        <span>Peak arrays</span>
      </label>
      <select
        v-if="result.columns.length > 6"
        v-model="jumpCol"
        class="jump"
        title="Scroll to a column"
        @change="jumpTo(jumpCol)"
      >
        <option value="">Jump to column…</option>
        <option v-for="c in result.columns" :key="c" :value="c">{{ c }}</option>
      </select>
      <div class="muted info">
        <span v-if="msg" class="flash">{{ msg }} · </span>
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
    <HScroll v-else ref="hs">
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
              :class="{ num: typeof v === 'number' || typeof v === 'bigint', 'mono': typeof v === 'string', active: menu && menu.i === i && menu.j === j }"
              @contextmenu.prevent="openMenu($event, i, j)"
            >
              <ResultCell
                :value="v"
                :expanded="!!expanded[cellKey(i, j)]"
                :segs="segsFor(i, j)"
                :mods="isModsCell(j)"
                :ptm="ptmOn"
                :peak="isPeakCol(j)"
                toggle-titles
                @toggle="toggle(i, j)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </HScroll>

    <CellMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :psm="!!psmRef"
      :spectrum-block="spectrumBlock"
      :value="result.rows[menu.i]?.[menu.j]"
      :column="result.columns[menu.j]"
      :expanded="!!expanded[cellKey(menu.i, menu.j)]"
      @close="closeMenu"
      @spectrum="viewSpectrum"
      @expand="expandCell"
      @copy-cell="copyCell"
      @copy-row="copyRow"
      @filter="filterBy"
    />

    <SpectrumViewer
      v-if="spectrum && psmRef"
      :psm="psmRef"
      :target="spectrum"
      :accession="state.selectedDataset?.prefix"
      :file-base="state.selectedDataset?.prefix"
      @close="spectrum = null"
    />
  </div>
</template>

<style scoped>
/* The table scrolls inside a box bounded by the window, so the horizontal
   scrollbar always sits at the bottom of the panel, not after the last row. */
.table-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
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
.jump {
  font-size: 12px;
  max-width: 190px;
}
th.flash-col {
  background: color-mix(in srgb, var(--accent) 35%, var(--bg-soft));
  transition: background 0.3s;
}
td.active {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.flash {
  color: var(--accent);
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
.pad {
  padding: 18px;
}
</style>
