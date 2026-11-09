// QPX format names: the views the viewer reads, the columns it reads from
// them (COL), a footer key and the sample facets, all checked against the
// QPX spec (bigbio/qpx qpx/core/data/schemas, at 15afbca1).
//
// A QPX 1.3 relayout changes two things readers see:
// - feature_id, psm_id and pg_id are renumbered to row ordinals. The viewer
//   reads no ids (none is in COL), so only the values shown in tables change.
// - Name-value lists (additional_scores, cv_params, additional_intensities)
//   may be stored as one struct with a field per name (footer
//   `qpx.struct_lists`): see cvMap below and isScoreList in format.

/** Views the reports read. */
export type ViewKind = "feature" | "psm" | "pg" | "run" | "sample" | "dataset";
export const VIEW_KINDS: readonly ViewKind[] = ["feature", "psm", "pg", "run", "sample", "dataset"];

/** Views that give a dataset a report: peptide-level evidence or protein groups. */
export const REPORT_VIEWS = new Set<string>(["feature", "psm", "pg"] satisfies ViewKind[]);

/** `{ a: "a", … }` for the names given: code writes `COL.charge` where it
 * would spell "charge", and a misspelt name is a type error. */
function names<const T extends string>(...xs: T[]): { readonly [K in T]: K } {
  return Object.fromEntries(xs.map((x) => [x, x])) as { readonly [K in T]: K };
}

/** The view columns the viewer reads, by the views that have them. Queries
 * and components name columns through these. Fields inside struct columns
 * (modifications[].name, intensities[].label, a run's
 * samples[].sample_accession, …) and CTE or output column names stay in the
 * query that unnests or defines them. */
export const COL = names(
  // feature and psm
  "run_file_name", // also run
  "peptidoform",
  "sequence",
  "modifications",
  "charge",
  "is_decoy", // also pg
  "posterior_error_probability",
  "calculated_mz",
  "observed_mz",
  "mass_error_ppm",
  "rt",
  "missed_cleavages",
  "scan",
  "cv_params", // also pg; 1.3: may be a struct with a field per name
  // feature and pg
  "anchor_protein",
  "pg_accessions",
  "gg_names",
  "gg_accessions",
  "global_qvalue",
  // feature
  "peptide_qvalue",
  "unique",
  "intensities",
  "rt_start",
  "rt_stop",
  // psm
  "protein_accessions",
  "mz_array",
  "intensity_array",
  "charge_array",
  "ion_type_array",
  "ion_mobility_array",
  // pg
  "pg_names",
  "pg_qvalue",
  "sequence_coverage",
  "peptide_counts",
  "feature_counts",
  "contaminant",
  // run
  "instrument",
  "fraction",
  "enzymes",
  "samples",
  "modification_parameters",
  // sample
  "sample_accession",
  "organism",
  "organism_part",
  "disease",
  "cell_line",
  "cell_type",
  "sex",
  "developmental_stage",
  // dataset
  "project_accession",
  "project_title",
  "project_description",
  "pubmed_id",
  "software_name",
  "software_version",
  "creation_date"
);

/** Footer key holding the comma-separated sort columns that relayout wrote. */
export const SORT_ORDER_KEY = "qpx.sort_order";

/** Sample-view characteristics charted as facets, in display order.
 * histologic_subtype is not in the spec; it shows when a sample view has it. */
export const SAMPLE_FACETS = [
  COL.organism,
  COL.organism_part,
  COL.disease,
  COL.cell_line,
  COL.cell_type,
  COL.sex,
  COL.developmental_stage,
  "histologic_subtype",
];

// Equivalent cv_params keys across converters (π-MSNet uses PSI-MS names,
// quantms uses short struct field names).
const CV_ALIASES: Record<string, string> = {
  "fragmentation method": "dissociation method",
  "collision energy": "normalized collision energy",
};

/** `cv_params` as lower-case name -> value. Files store it as a list of
 * {cv_name, cv_value} structs, a MAP, or (after a QPX 1.3 relayout) a struct
 * with one field per name. */
export function cvMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) {
    for (const p of v as any[]) {
      if (!p || typeof p !== "object") continue;
      const k = p.cv_name ?? p.name ?? p.key;
      if (k != null) out[String(k)] = String(p.cv_value ?? p.value ?? "");
    }
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x != null && typeof x !== "object") out[k] = String(x);
    }
  }
  const norm: Record<string, string> = {};
  for (const [k, x] of Object.entries(out)) {
    const lk = k.toLowerCase();
    norm[CV_ALIASES[lk] ?? lk] = x;
  }
  return norm;
}
