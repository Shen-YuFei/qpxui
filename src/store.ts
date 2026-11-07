import { reactive } from "vue";
import type { DatasetInfo, ViewInfo } from "./lib/api";
import { clearReportCache } from "./lib/report";
import { abandonQueries } from "./lib/duck";

// Simple reactive store (no Pinia needed for this scale).
export const state = reactive({
  datasets: [] as DatasetInfo[],
  sourceKind: "none" as string, // single-file | dataset | collection | s3
  selectedDataset: null as DatasetInfo | null,
  selectedView: null as ViewInfo | null,
  /** Set of local file paths already registered as DuckDB tables. */
  registered: new Set<string>(),
  /** Map of view path -> DuckDB table name. */
  tableName: {} as Record<string, string>,
  busy: false,
  status: "" as string,
  error: "" as string,
  /** Main panel: a single view (browse/summary/query) or the dataset report. */
  page: "view" as "view" | "report",
  reportTab: "overview" as ReportTab,
  /** Search request handed to the report's Proteins / Peptides tabs. */
  search: { proteins: "", peptides: "", mod: "", nonce: 0 },
  /** Protein (anchor accession) opened in the Proteins tab detail pane. */
  proteinFocus: null as string | null,
});

export type ReportTab = "overview" | "qc" | "ptms" | "samples" | "proteins" | "peptides" | "quant";

/** Open the dataset report, optionally on a given tab. */
export function openReport(tab?: ReportTab) {
  state.page = "report";
  if (tab) state.reportTab = tab;
}

/** Run a search from anywhere (sidebar box, peptide -> protein links). */
export function searchFor(scope: "proteins" | "peptides", q: string, mod = "") {
  state.search[scope] = q;
  if (scope === "peptides") state.search.mod = mod;
  state.search.nonce++;
  if (scope === "proteins") state.proteinFocus = null;
  openReport(scope);
}

export function openProtein(acc: string) {
  state.proteinFocus = acc;
  openReport("proteins");
}

/** Leaving a dataset: stop its running queries so the next one starts at
 * once. A restarted engine has no tables, so forget what was registered. */
export function stopQueries() {
  if (!abandonQueries()) return;
  clearReportCache();
  state.registered = new Set();
  state.tableName = {};
}

export function reset() {
  stopQueries();
  clearReportCache();
  state.datasets = [];
  state.sourceKind = "none";
  state.selectedDataset = null;
  state.selectedView = null;
  state.registered = new Set();
  state.tableName = {};
  state.busy = false;
  state.status = "";
  state.error = "";
  state.page = "view";
  state.reportTab = "overview";
  state.search = { proteins: "", peptides: "", mod: "", nonce: 0 };
  state.proteinFocus = null;
}

export function loadDatasets(datasets: DatasetInfo[], kind: string) {
  stopQueries();
  clearReportCache();
  state.datasets = datasets;
  state.sourceKind = kind;
  state.selectedDataset = datasets[0] ?? null;
  state.selectedView = datasets[0]?.views[0] ?? null;
  state.registered = new Set();
  state.tableName = {};
  state.page = hasReport(datasets[0]) ? "report" : "view";
  state.reportTab = "overview";
  state.proteinFocus = null;
  state.status = `Loaded ${datasets.length} dataset(s)`;
}

export function datasetByView(view: ViewInfo): DatasetInfo | undefined {
  return state.datasets.find((d) => d.views.some((v) => v.path === view.path));
}

/** A dataset gets a report when it has peptide-level evidence or protein groups. */
export function hasReport(d: DatasetInfo | null | undefined): boolean {
  return !!d && d.views.some((v) => v.format === "parquet" && ["feature", "psm", "pg"].includes(v.view));
}
