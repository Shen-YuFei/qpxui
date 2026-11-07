<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { countRows, describeTable, ensureViewReady, type QueryResult } from "../lib/duck";
import { isStructured } from "../lib/format";
import type { ViewInfo } from "../lib/api";
import type { TableRef } from "../lib/report";
import { viewScale } from "../lib/report";
import { cellFilter, isPeakColumn, tablePage } from "../lib/queries/table";
import { state } from "../store";
import ResultCell from "./table/ResultCell.vue";
import SpectrumViewer from "./SpectrumViewer.vue";
import type { PsmKey } from "../lib/queries/spectrum";
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

function rowValue(i: number, col: string): unknown {
  const j = result.value.columns.findIndex((c) => c.toLowerCase() === col);
  return j >= 0 ? result.value.rows[i]?.[j] : undefined;
}

/** Why the selected row cannot open the spectrum viewer, or "" when it can. */
const spectrumBlock = computed<string>(() => {
  if (!menu.value || !psmRef.value) return "Spectra need a psm view with peptidoform and peak arrays";
  const pf = rowValue(menu.value.i, "peptidoform");
  if (typeof pf !== "string" || !pf) return "This PSM has no peptidoform";
  if (showPeaks.value) {
    const mz = rowValue(menu.value.i, "mz_array");
    if (!Array.isArray(mz) || !mz.length) return "This PSM has no stored peaks";
  }
  return "";
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
  const scan = rowValue(m.i, "scan");
  const charge = rowValue(m.i, "charge");
  const run = rowValue(m.i, "run_file_name");
  spectrum.value = {
    peptidoform: String(rowValue(m.i, "peptidoform")),
    run_file_name: run == null ? null : String(run),
    scan: Array.isArray(scan) ? (scan[0] as number) ?? null : ((scan as number) ?? null),
    charge: (charge as number) ?? null,
  };
}

function cellText(v: unknown): string {
  return isStructured(v) ? JSON.stringify(v) : v == null ? "" : String(v);
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
  await copy(JSON.stringify(Object.fromEntries(cols.map((c, j) => [c, row[j]])), null, 2), "Row copied as JSON");
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

/** Only scalar cells can become a WHERE filter. */
const canFilter = computed(() => {
  const m = menu.value;
  if (!m) return false;
  const v = result.value.rows[m.i]?.[m.j];
  return v == null || !isStructured(v);
});
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
const menuStructured = computed(() => {
  const m = menu.value;
  return !!m && isStructured(result.value.rows[m.i]?.[m.j]);
});

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") closeMenu();
}

// ---- Always-visible horizontal scrollbar ----
// Native scrollbars are overlays on macOS (hidden until you scroll), so the
// table gets its own track + thumb pinned under it.
const scroller = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
const sx = ref({ left: 0, client: 1, width: 1 });
const hasHScroll = computed(() => sx.value.width > sx.value.client + 1);
const thumbPct = computed(() => Math.max(4, (sx.value.client / sx.value.width) * 100));
const thumbLeft = computed(() => {
  const max = sx.value.width - sx.value.client;
  return max > 0 ? (sx.value.left / max) * (100 - thumbPct.value) : 0;
});
function syncScroll() {
  const s = scroller.value;
  if (s) sx.value = { left: s.scrollLeft, client: s.clientWidth, width: s.scrollWidth };
}
let drag: { x: number; left: number } | null = null;
function thumbDown(e: PointerEvent) {
  const s = scroller.value;
  if (!s) return;
  drag = { x: e.clientX, left: s.scrollLeft };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}
function thumbMove(e: PointerEvent) {
  const s = scroller.value;
  const t = track.value;
  if (!drag || !s || !t) return;
  const free = t.clientWidth * (1 - thumbPct.value / 100);
  if (free <= 0) return;
  s.scrollLeft = drag.left + ((e.clientX - drag.x) / free) * (s.scrollWidth - s.clientWidth);
}
function thumbUp() {
  drag = null;
}
function trackDown(e: PointerEvent) {
  const s = scroller.value;
  const t = track.value;
  if (!s || !t || e.target !== t) return;
  const r = t.getBoundingClientRect();
  const frac = (e.clientX - r.left) / r.width;
  s.scrollLeft = frac * s.scrollWidth - s.clientWidth / 2;
}

/** Scroll a column into view (and flash its header). */
const jumpCol = ref("");
function jumpTo(col: string) {
  jumpCol.value = "";
  const s = scroller.value;
  const j = result.value.columns.indexOf(col);
  const th = s?.querySelectorAll("thead th")[j] as HTMLElement | undefined;
  if (!s || !th) return;
  s.scrollLeft = th.offsetLeft - 24;
  th.classList.add("flash-col");
  setTimeout(() => th.classList.remove("flash-col"), 1200);
}

let ro: ResizeObserver | null = null;
watch(scroller, (el, old) => {
  if (old) ro?.unobserve(old);
  if (el) {
    ro ??= new ResizeObserver(syncScroll);
    ro.observe(el);
    const tbl = el.querySelector("table");
    if (tbl) ro.observe(tbl);
    syncScroll();
  }
});
watch(result, () => requestAnimationFrame(syncScroll));

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("blur", closeMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("blur", closeMenu);
  ro?.disconnect();
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
    <div class="scroll" v-else ref="scroller" @scroll="syncScroll">
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
              :class="{ num: typeof v === 'number', 'mono': typeof v === 'string', active: menu && menu.i === i && menu.j === j }"
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
    </div>
    <div v-if="!loading && !error && hasHScroll" ref="track" class="hbar" title="Drag to scroll columns" @pointerdown="trackDown">
      <div
        class="hthumb"
        :style="{ width: thumbPct + '%', left: thumbLeft + '%' }"
        @pointerdown.stop="thumbDown"
        @pointermove="thumbMove"
        @pointerup="thumbUp"
        @pointercancel="thumbUp"
      ></div>
    </div>

    <template v-if="menu">
      <div class="menu-backdrop" @click="closeMenu" @contextmenu.prevent="closeMenu"></div>
      <div class="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" role="menu">
        <button
          v-if="psmRef"
          role="menuitem"
          :disabled="!!spectrumBlock"
          :title="spectrumBlock || 'Open the annotated spectrum of this PSM'"
          @click="viewSpectrum"
        >
          <span class="mi">📈</span> View spectrum
          <span v-if="spectrumBlock" class="why">{{ spectrumBlock }}</span>
        </button>
        <button v-if="menuStructured" role="menuitem" @click="expandCell">
          <span class="mi">{{ expanded[cellKey(menu.i, menu.j)] ? "▾" : "▸" }}</span>
          {{ expanded[cellKey(menu.i, menu.j)] ? "Collapse cell" : "Expand cell" }}
        </button>
        <button role="menuitem" @click="copyCell"><span class="mi">⧉</span> Copy value</button>
        <button role="menuitem" @click="copyRow"><span class="mi">⧉</span> Copy row (JSON)</button>
        <button v-if="canFilter" role="menuitem" @click="filterBy">
          <span class="mi">⏷</span> Filter: {{ result.columns[menu.j] }} = this
        </button>
      </div>
    </template>

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
.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.scroll::-webkit-scrollbar:horizontal {
  display: none;
  height: 0;
}
.hbar {
  position: relative;
  flex: none;
  height: 14px;
  background: var(--bg-soft);
  border-top: 1px solid var(--border);
  cursor: pointer;
}
.hthumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  cursor: grab;
  touch-action: none;
}
.hthumb:hover,
.hthumb:active {
  background: var(--accent);
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
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.menu {
  position: fixed;
  z-index: 41;
  min-width: 200px;
  max-width: 320px;
  padding: 4px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
}
.menu button {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  text-align: left;
  border: none;
  background: transparent;
  padding: 6px 10px;
  border-radius: 5px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
.menu button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.menu .mi {
  width: 16px;
  text-align: center;
}
.menu .why {
  flex-basis: 100%;
  padding-left: 22px;
  font-size: 10px;
  color: var(--muted, var(--text));
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
