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
    if (Number.isInteger(v) && Math.abs(v) > 1e12) return v.toLocaleString();
    if (!Number.isInteger(v)) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return v.toLocaleString();
  }
  return String(v);
}

/** Short, single-line summary for a structured value (for collapsed cells). */
function isScoreList(v: unknown): v is Array<Record<string, unknown>> {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => isStructured(x) && "score_name" in (x as object))
  );
}
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
      (m) => `${m.score_name ?? "score"}=${scalarText(m.score_value ?? "∅")}`
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

function build(v: unknown, depth: number, lines: string[]): void {
  const pad = "  ".repeat(depth);
  if (Array.isArray(v)) {
    if (v.length === 0) {
      lines.push(pad + "∅");
      return;
    }
    // Flat array of plain scalars -> inline.
    if (v.every((x) => !isStructured(x))) {
      lines.push(pad + "[" + v.map(scalarText).join(", ") + "]");
      return;
    }
    // Array of structured items -> one bulleted block per element.
    v.forEach((item) => {
      if (isStructured(item)) {
        const entries = Object.entries(item as Structured);
        if (!entries.length) {
          lines.push(pad + "• { }");
        } else if (entries.every(([, x]) => !isStructured(x))) {
          lines.push(
            pad + "• " + entries.map(([k, x]) => `${k}: ${scalarText(x)}`).join(" · ")
          );
        } else {
          entries.forEach(([k, x], ei) => {
            if (isStructured(x)) {
              lines.push(pad + (ei === 0 ? "• " : "  ") + k + ":");
              build(x, depth + 1, lines);
            } else {
              lines.push(pad + (ei === 0 ? "• " : "  ") + k + ": " + scalarText(x));
            }
          });
        }
      } else {
        lines.push(pad + "• " + scalarText(item));
      }
    });
    return;
  }
  if (isStructured(v)) {
    const entries = Object.entries(v as Structured);
    if (entries.length === 0) {
      lines.push(pad + "{ }");
      return;
    }
    if (entries.every(([, x]) => !isStructured(x))) {
      lines.push(pad + entries.map(([k, x]) => `${k}: ${scalarText(x)}`).join(" · "));
      return;
    }
    entries.forEach(([k, x]) => {
      if (isStructured(x)) {
        lines.push(pad + k + ":");
        build(x, depth + 1, lines);
      } else {
        lines.push(pad + k + ": " + scalarText(x));
      }
    });
    return;
  }
  lines.push(pad + scalarText(v));
}

/** Pretty, multi-line rendering of a (possibly deeply nested) value. */
export function formatValue(v: unknown): string {
  const lines: string[] = [];
  build(v, 0, lines);
  return lines.join("\n");
}
