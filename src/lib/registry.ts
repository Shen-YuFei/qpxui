// The quantms portal registry as the picker lists it: a text search over
// accession, title, organism, instrument and collection, sorted by accession
// or by one of the counts.
import { portalRef, type PortalDataset } from "./api";

export type RegistrySort = "accession" | "totalSize" | "peptides" | "psmCount" | "proteins" | "samples";

export const REGISTRY_SORTS: { key: RegistrySort; label: string }[] = [
  { key: "accession", label: "Accession" },
  { key: "totalSize", label: "Size" },
  { key: "peptides", label: "Peptides" },
  { key: "psmCount", label: "PSMs" },
  { key: "proteins", label: "Proteins" },
  { key: "samples", label: "Samples" },
];

/** The sort after clicking `k`: the current key reverses; another key
 * starts largest-first for numbers, A→Z for accessions. */
export function nextSort(cur: { key: RegistrySort; desc: boolean }, k: RegistrySort): { key: RegistrySort; desc: boolean } {
  return cur.key === k ? { key: k, desc: !cur.desc } : { key: k, desc: k !== "accession" };
}

/** The datasets matching `query` (any case), sorted by `key`; datasets
 * without that count come last, ties go by reference. */
export function filterRegistry(rows: PortalDataset[], query: string, key: RegistrySort, desc: boolean): PortalDataset[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? rows.filter((r) =>
        [r.accession, r.title, r.organism, r.instrument, r.collectionTitle]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(q))
      )
    : [...rows];
  const dir = desc ? -1 : 1;
  return list.sort((a, b) => {
    if (key === "accession") return dir * portalRef(a).localeCompare(portalRef(b));
    // Missing values always sink to the bottom.
    const x = a[key] ?? null;
    const y = b[key] ?? null;
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return dir * (x - y) || portalRef(a).localeCompare(portalRef(b));
  });
}
