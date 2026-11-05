import { reactive } from "vue";
import type { DatasetInfo, ViewInfo } from "./lib/api";

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
});

export function reset() {
  state.datasets = [];
  state.sourceKind = "none";
  state.selectedDataset = null;
  state.selectedView = null;
  state.registered = new Set();
  state.tableName = {};
  state.busy = false;
  state.status = "";
  state.error = "";
}

export function loadDatasets(datasets: DatasetInfo[], kind: string) {
  state.datasets = datasets;
  state.sourceKind = kind;
  state.selectedDataset = datasets[0] ?? null;
  state.selectedView = datasets[0]?.views[0] ?? null;
  state.registered = new Set();
  state.tableName = {};
  state.status = `Loaded ${datasets.length} dataset(s)`;
}

export function datasetByView(view: ViewInfo): DatasetInfo | undefined {
  return state.datasets.find((d) => d.views.some((v) => v.path === view.path));
}
