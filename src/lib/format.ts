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

/** A QPX score list: STRUCTs with a `score_name`. */
function isScoreList(v: unknown): v is Array<Record<string, unknown>> {
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

/** Byte count in binary units ("1.5 GB"). */
export function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return i === 0 ? `${n} B` : `${(n / 1024 ** i).toFixed(1)} ${u[i]}`;
}
