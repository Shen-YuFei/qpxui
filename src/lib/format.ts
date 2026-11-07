// Human-friendly rendering of DuckDB cell values, including nested
// structured types (STRUCT, LIST, MAP) that come back from duckdb-wasm as
// plain JS objects / arrays (e.g. the `modifications` column in PSM views).

export type Structured = Record<string, unknown>;

export function isStructured(v: unknown): v is Structured | unknown[] {
  return v !== null && typeof v === "object";
}

/** Compact single-line representation of a scalar value. */
export function scalarText(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isInteger(v)) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return v.toLocaleString();
  }
  return String(v);
}

/** A QPX score list: STRUCTs with a `score_name`. A QPX 1.3 relayout may
 * store additional_scores as one struct with a field per score name instead;
 * that renders as a plain struct. */
export function isScoreList(v: unknown): v is Array<Record<string, unknown>> {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => isStructured(x) && "score_name" in (x as object))
  );
}
/** A QPX modification list: STRUCTs with a `name` and an `accession`. */
function isModList(v: unknown): v is Array<Record<string, unknown>> {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => isStructured(x) && "name" in (x as object) && "accession" in (x as object))
  );
}

/** Short, single-line summary for a structured value (for collapsed cells). */
/** A peak array as "N peaks" ("∅" when missing). */
export function peakSummary(v: unknown): string {
  if (!Array.isArray(v)) return "∅";
  return v.length ? `${v.length.toLocaleString()} peaks` : "no peaks";
}

export function formatCompact(v: unknown): string {
  if (isScoreList(v)) {
    const shown = v.slice(0, 5).map(
      (m) => `${m.score_name ?? "score"}=${scalarText(m.score_value)}`
    );
    const more = v.length > 5 ? ` … +${v.length - 5}` : "";
    return `${shown.join(", ")}${more}`;
  }
  if (isModList(v)) {
    const names = v.slice(0, 4).map((m) => String(m.name ?? "PTM"));
    const more = v.length > 4 ? ` … +${v.length - 4}` : "";
    return `${names.join(" + ")}${more}`;
  }
  if (Array.isArray(v)) {
    if (!v.length) return "∅ (empty list)";
    if (v.every((x) => !isStructured(x))) {
      if (v.length <= 8) return `[${v.map(scalarText).join(", ")}]`;
      return `[${v.slice(0, 3).map(scalarText).join(", ")}, …] (${v.length.toLocaleString()} values)`;
    }
    return `• ${v.length} item(s)`;
  }
  if (isStructured(v)) {
    const entries = Object.entries(v as Structured);
    if (!entries.length) return "{ }";
    if (entries.every(([, x]) => !isStructured(x))) {
      return `{ ${entries.map(([k, x]) => `${k}: ${scalarText(x)}`).join(", ")} }`;
    }
    return `{ ${entries.length} field(s) }`;
  }
  return scalarText(v);
}

/** A file size with one decimal in every unit ("512.0 B", "1.5 MB"), as the
 * sidebar, the source pickers and the portal lists show sizes; `zero` stands
 * for a missing or zero size. */
export function fmtSize(n: number | null | undefined, zero = "—"): string {
  if (!n) return zero;
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(1)} ${u[i]}`;
}

/** Byte count in binary units ("1.5 GB"). */
export function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return i === 0 ? `${n} B` : `${(n / 1024 ** i).toFixed(1)} ${u[i]}`;
}

export function fmtNum(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a === 0) return "0";
  if (a >= 1000) return x.toFixed(0);
  if (a >= 10) return x.toFixed(1);
  if (a >= 1) return x.toFixed(2);
  return x.toPrecision(2);
}

/** A dataset count for the portal lists (1.2K, 34K, 5.6M); a dash when the
 * portal has none. */
export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}
export function fmtShort(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

/** The first `max` elements of a list (or a scalar) as one line; struct
 * elements in their compact form. */
export function listText(v: unknown, max = 3): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) {
    const items = v.filter((x) => x !== null && x !== undefined).map((x) => (isStructured(x) ? formatCompact(x) : String(x)));
    return items.length > max ? `${items.slice(0, max).join(", ")} +${items.length - max}` : items.join(", ");
  }
  return String(v);
}
