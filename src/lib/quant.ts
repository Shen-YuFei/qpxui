// Protein x sample abundance matrix and the statistics the Quantification tab
// draws from it: normalisation, sample correlation, clustering order and PCA.

export interface QuantMatrix {
  /** Column (sample, or run/channel) names. */
  samples: string[];
  /** Row identifiers (anchor protein). */
  proteins: string[];
  genes: (string | null)[];
  /** log2 abundance per protein, one value per sample; NaN = missing. */
  values: Float64Array[];
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Observed (finite) values of one sample column. */
export function column(m: QuantMatrix, j: number): number[] {
  const out: number[] = [];
  for (const row of m.values) if (Number.isFinite(row[j])) out.push(row[j]);
  return out;
}

/** Shift every sample so its median equals the median of all sample medians. */
export function medianNormalize(m: QuantMatrix): QuantMatrix {
  const meds = m.samples.map((_, j) => median(column(m, j)));
  const target = median(meds.filter(Number.isFinite));
  const values = m.values.map((row) => row.map((v, j) => v - meds[j] + target));
  return { ...m, values };
}

/** Number of samples in which each protein was quantified. */
export function presence(row: Float64Array): number {
  let k = 0;
  for (const v of row) if (Number.isFinite(v)) k++;
  return k;
}

/** Pearson correlation between sample columns over proteins observed in both. */
export function correlation(rows: Float64Array[], n: number): number[][] {
  const r = Array.from({ length: n }, () => new Array<number>(n).fill(NaN));
  for (let a = 0; a < n; a++) {
    r[a][a] = 1;
    for (let b = a + 1; b < n; b++) {
      let k = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (const row of rows) {
        const x = row[a];
        const y = row[b];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        k++;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
      }
      let v = NaN;
      if (k >= 3) {
        const cov = sxy - (sx * sy) / k;
        const den = Math.sqrt((sxx - (sx * sx) / k) * (syy - (sy * sy) / k));
        v = den > 0 ? cov / den : NaN;
      }
      r[a][b] = r[b][a] = v;
    }
  }
  return r;
}

/** Leaf order of an average-linkage hierarchical clustering of a distance
 * matrix (NaN distances count as the largest distance). */
export function averageLinkageOrder(dist: number[][]): number[] {
  const n = dist.length;
  if (n < 3) return [...Array(n).keys()];
  let maxD = 0;
  for (const row of dist) for (const v of row) if (Number.isFinite(v) && v > maxD) maxD = v;
  const d = dist.map((row) => row.map((v) => (Number.isFinite(v) ? v : maxD)));
  const members: (number[] | null)[] = [...Array(n).keys()].map((i) => [i]);
  for (let step = 0; step < n - 1; step++) {
    let bi = -1, bj = -1, best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!members[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!members[j]) continue;
        if (d[i][j] < best) {
          best = d[i][j];
          bi = i;
          bj = j;
        }
      }
    }
    const ni = members[bi]!.length;
    const nj = members[bj]!.length;
    for (let k = 0; k < n; k++) {
      if (!members[k] || k === bi || k === bj) continue;
      d[bi][k] = d[k][bi] = (ni * d[bi][k] + nj * d[bj][k]) / (ni + nj);
    }
    members[bi] = [...members[bi]!, ...members[bj]!];
    members[bj] = null;
  }
  return members.find((x) => x)!;
}

export interface Pca {
  /** scores[sample][component] */
  scores: number[][];
  /** Fraction of total variance per component. */
  explained: number[];
  /** Proteins used. */
  used: number;
}

/**
 * PCA of samples over proteins. Each protein is mean-centred over the samples
 * where it was observed; missing values are set to that mean (0 after
 * centring). Components come from the samples x samples Gram matrix by power
 * iteration with deflation, which is cheap because samples are few.
 */
export function pca(rows: Float64Array[], n: number, k = 3): Pca {
  const X: Float64Array[] = []; // proteins x samples, centred
  for (const row of rows) {
    let s = 0, c = 0;
    for (const v of row) if (Number.isFinite(v)) { s += v; c++; }
    if (c < 2) continue;
    const mean = s / c;
    X.push(row.map((v) => (Number.isFinite(v) ? v - mean : 0)));
  }
  const G = Array.from({ length: n }, () => new Float64Array(n));
  for (const x of X) {
    for (let a = 0; a < n; a++) {
      const xa = x[a];
      if (!xa) continue;
      for (let b = a; b < n; b++) G[a][b] += xa * x[b];
    }
  }
  for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) G[a][b] = G[b][a];
  let trace = 0;
  for (let a = 0; a < n; a++) trace += G[a][a];
  const comps = Math.min(k, n);
  const scores = Array.from({ length: n }, () => new Array<number>(comps).fill(0));
  const explained: number[] = [];
  for (let c = 0; c < comps; c++) {
    let v = new Float64Array(n).map((_, i) => 1 + ((i * 7 + c * 3) % 11) / 10);
    let lambda = 0;
    for (let it = 0; it < 500; it++) {
      const w = new Float64Array(n);
      for (let a = 0; a < n; a++) {
        let s = 0;
        for (let b = 0; b < n; b++) s += G[a][b] * v[b];
        w[a] = s;
      }
      const norm = Math.hypot(...w);
      if (!norm) break;
      for (let a = 0; a < n; a++) w[a] /= norm;
      let diff = 0;
      for (let a = 0; a < n; a++) diff += Math.abs(w[a] - v[a]);
      v = w;
      lambda = norm;
      if (diff < 1e-10) break;
    }
    // Stable sign: the largest loading is positive.
    let big = 0;
    for (let a = 0; a < n; a++) if (Math.abs(v[a]) > Math.abs(v[big])) big = a;
    if (v[big] < 0) v = v.map((x) => -x);
    const sd = Math.sqrt(Math.max(lambda, 0));
    for (let a = 0; a < n; a++) scores[a][c] = v[a] * sd;
    explained.push(trace > 0 ? lambda / trace : 0);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) G[a][b] -= lambda * v[a] * v[b];
  }
  return { scores, explained, used: X.length };
}

/** Natural ("Sample-2" < "Sample-10") string compare. */
export const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Sample attributes that split `samples` into 2..12 groups (fewer groups
 * than samples), the most informative first. `meta` maps sample accession to
 * its sample-view row. */
export function groupingColumns(samples: string[], meta: Map<string, Record<string, any>>): string[] {
  const rows = samples.map((s) => meta.get(s)).filter(Boolean) as Record<string, any>[];
  if (!rows.length) return [];
  const out: string[] = [];
  for (const k of Object.keys(rows[0])) {
    if (k === "sample_accession") continue;
    const vals = new Set(rows.map((r) => (r[k] == null ? null : String(r[k]))).filter((v) => v !== null && v !== ""));
    if (vals.size >= 2 && vals.size < rows.length && vals.size <= 12) out.push(k);
  }
  const pref = ["disease", "histologic_subtype", "organism_part", "cell_type", "cell_line", "sex", "developmental_stage"];
  return out.sort((a, b) => ((pref.indexOf(a) + 1 || 99) - (pref.indexOf(b) + 1 || 99)) || a.localeCompare(b));
}

/** A sample's value of the attribute `by` in `meta` ("not available" when it
 * has none), or "" when not grouping. */
export function sampleGroup(meta: Map<string, Record<string, any>>, by: string, sample: string): string {
  if (!by) return "";
  const v = meta.get(sample)?.[by];
  return v == null || v === "" ? "not available" : String(v);
}

/** The matrix without the proteins `flagged` marks (1 = drop). */
export function withoutFlagged(m: QuantMatrix, flagged: Uint8Array): QuantMatrix {
  const keep = m.proteins.map((_, i) => !flagged[i]);
  return {
    samples: m.samples,
    proteins: m.proteins.filter((_, i) => keep[i]),
    genes: m.genes.filter((_, i) => keep[i]),
    values: m.values.filter((_, i) => keep[i]),
  };
}

/** Column indices ordered by group, then name. */
export function groupedOrder(samples: string[], groupOf: (sample: string) => string): number[] {
  return samples.map((_, j) => j).sort((a, b) => natural(groupOf(samples[a]), groupOf(samples[b])) || natural(samples[a], samples[b]));
}

/** A protein of the matrix: columns quantified, mean and SD of log2 abundance. */
export interface ProteinSummary {
  protein: string;
  gene: string | null;
  n: number;
  mean: number | null;
  sd: number | null;
}

export function proteinSummaries(m: QuantMatrix): ProteinSummary[] {
  return m.proteins.map((p, i) => {
    const xs = [...m.values[i]].filter(Number.isFinite);
    const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const sd = xs.length > 1 && mean != null ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : null;
    return { protein: p, gene: m.genes[i], n: xs.length, mean, sd };
  });
}

/** Proteins the protein list shows at most. */
export const PROTEIN_LIST_MAX = 500;

/** Proteins whose accession or gene contains `text` (any case), most
 * quantified first, then most abundant; at most PROTEIN_LIST_MAX. */
export function findProteins(all: ProteinSummary[], text: string): ProteinSummary[] {
  const s = text.trim().toLowerCase();
  const rows = s ? all.filter((r) => r.protein.toLowerCase().includes(s) || (r.gene ?? "").toLowerCase().includes(s)) : all;
  return [...rows].sort((a, b) => b.n - a.n || (b.mean ?? 0) - (a.mean ?? 0)).slice(0, PROTEIN_LIST_MAX);
}
