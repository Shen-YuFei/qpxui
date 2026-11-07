// The Query view: the user's SQL over one view, where `{table}` stands for
// the view's table, with a row cap when the query sets none.
import { runSql, type QueryResult } from "../duck";
import { ident } from "../report";

/** Rows a query returns when it ends without a LIMIT of its own. */
export const QUERY_LIMIT = 2000;

/** Example queries; `{table}` stands for the view's table. */
export const QUERY_EXAMPLES = [
  "SELECT * FROM {table} LIMIT 50",
  "SELECT anchor_protein, COUNT(*) AS n FROM {table} WHERE anchor_protein IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
  "SELECT run_file_name, COUNT(*) AS n FROM {table} GROUP BY 1 ORDER BY 2 DESC",
  "SELECT charge, COUNT(*) AS n FROM {table} GROUP BY 1 ORDER BY 1",
];

/** The text with its first `{table}` replaced by the quoted table name. */
export function substituteTable(text: string, table: string): string {
  return text.replace("{table}", ident(table));
}

/** The statement run for the query text: the whole table when the text is
 * empty, `{table}` substituted, and `LIMIT QUERY_LIMIT` appended unless the
 * query ends with a LIMIT. */
export function querySql(text: string, table: string): string {
  let body = text.trim();
  if (!body) body = `SELECT * FROM ${ident(table)}`;
  body = substituteTable(body, table);
  return /limit\s+\d+\s*$/i.test(body) ? body : `${body} LIMIT ${QUERY_LIMIT}`;
}

/** Runs the query text over the table. */
export function runQuery(text: string, table: string): Promise<QueryResult> {
  return runSql(querySql(text, table));
}
