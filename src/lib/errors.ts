// Error texts shared by the query engine and the views that show its errors.

/**
 * The text of a DuckDB error. A failed read of a streamed file (duckdb-wasm
 * reports those as "Range request for <url> …" or an unexpected status while
 * opening it) gets a hint, so the user knows it is usually the network or
 * credentials rather than a bug in the query.
 */
export function engineErrorText(e: unknown): string {
  const msg = String((e as any)?.message ?? e);
  if (/Range request for |Unexpected return status from server/.test(msg)) {
    return (
      `${msg}\n\n` +
      "Hint: this looks like a failed remote (streamed) read — check your AWS credentials " +
      "and network, or use “Download to cache” for this view instead."
    );
  }
  return msg;
}
