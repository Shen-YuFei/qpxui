// QPX format names that decide which views and code paths a dataset gets,
// checked against the QPX spec (bigbio/qpx docs/spec/schemas). Column names
// used inside SQL stay with their queries.
//
// A QPX 1.3 relayout changes two things readers see:
// - feature_id, psm_id and pg_id are renumbered to row ordinals. The viewer
//   never reads ids, so only the values shown in tables change.
// - Name-value lists (additional_scores, cv_params, additional_intensities)
//   may be stored as one struct with a field per name (footer
//   `qpx.struct_lists`): see cvMap in SpectrumViewer and isScoreList in format.

/** Views the reports read. */
export type ViewKind = "feature" | "psm" | "pg" | "run" | "sample" | "dataset";
export const VIEW_KINDS: readonly ViewKind[] = ["feature", "psm", "pg", "run", "sample", "dataset"];

/** Views that give a dataset a report: peptide-level evidence or protein groups. */
export const REPORT_VIEWS = new Set<string>(["feature", "psm", "pg"] satisfies ViewKind[]);

/** Footer key holding the comma-separated sort columns that relayout wrote. */
export const SORT_ORDER_KEY = "qpx.sort_order";

/** Sample-view characteristics charted as facets, in display order.
 * histologic_subtype is not in the spec; it shows when a sample view has it. */
export const SAMPLE_FACETS = [
  "organism",
  "organism_part",
  "disease",
  "cell_line",
  "cell_type",
  "sex",
  "developmental_stage",
  "histologic_subtype",
];
