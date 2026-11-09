// Colours for samples by a biological annotation, as on the quantms portal
// (its chartGroups.js and sampleColors.js): a value's biological group gives
// the hue (organ system from UBERON, taxonomic group from UniProt, disease
// class by name) and the values of one group take shades of it, so a tissue
// keeps its family colour from dataset to dataset. Developmental stages take
// a ramp in age order and sex fixed slots; any other annotation takes the
// categorical slots by count. The organ-system and taxon lookups go to the
// EBI Ontology Lookup Service and UniProt; until they answer, or when they
// cannot be reached, values take the slots by count as well.
import { ref, watch, type Ref } from "vue";
import { chartTheme, type ChartTheme } from "./charts";
import { mix, ramp, shades } from "./colours";
import { COL } from "./qpx";

const UNIPROT_TAXONOMY = "https://rest.uniprot.org/taxonomy/search";
const OLS = "https://www.ebi.ac.uk/ols4/api/v2/ontologies";

// Categorical slots by name (indices into ChartTheme.cat). Groups take the hue
// they are associated with where one exists (blood red, plants green).
const [BLUE, ORANGE, GREEN, YELLOW, PINK, DARK_GREEN, PURPLE, RED] = [0, 1, 2, 3, 4, 5, 6, 7];

interface Group {
  label: string;
  slot: number;
}

/** The first group with a taxon in the organism's lineage wins, so narrower groups come first. */
export const TAXON_GROUPS: (Group & { taxa: string[] })[] = [
  { label: "Mammals", taxa: ["Mammalia"], slot: BLUE },
  { label: "Other vertebrates", taxa: ["Vertebrata"], slot: PURPLE },
  { label: "Invertebrates", taxa: ["Metazoa"], slot: ORANGE },
  { label: "Plants and green algae", taxa: ["Viridiplantae"], slot: DARK_GREEN },
  { label: "Fungi", taxa: ["Fungi"], slot: YELLOW },
  { label: "Other eukaryotes", taxa: ["Eukaryota"], slot: PINK },
  { label: "Bacteria and archaea", taxa: ["Bacteria", "Archaea"], slot: GREEN },
  { label: "Viruses", taxa: ["Viruses"], slot: RED },
];
const SEVERAL_ORGANISMS = "Several organisms";
const NOT_IN_UNIPROT = "Not found in UniProt";

/** UBERON terms (and the haematopoietic cell, from CL) whose parts make up each
 * group; the first group a tissue belongs to wins (liver: digestive before endocrine). */
export const ORGAN_SYSTEMS: (Group & { ids: string[] })[] = [
  { label: "Blood and immune system", ids: ["UBERON:0002193", "CL:0000988"], slot: RED },
  { label: "Nervous system", ids: ["UBERON:0001016"], slot: YELLOW },
  { label: "Digestive system", ids: ["UBERON:0001007"], slot: GREEN },
  { label: "Cardiovascular system", ids: ["UBERON:0004535"], slot: ORANGE },
  { label: "Respiratory system", ids: ["UBERON:0001004"], slot: BLUE },
  { label: "Reproductive and urinary systems", ids: ["UBERON:0000990", "UBERON:0001008"], slot: PURPLE },
  { label: "Endocrine system", ids: ["UBERON:0000949"], slot: PINK },
  { label: "Cells and cell culture", ids: [], slot: DARK_GREEN },
];
const CELLS = ORGAN_SYSTEMS[ORGAN_SYSTEMS.length - 1].label;
const NO_SYSTEM = "Other or no organ system";
const NOT_IN_UBERON = "Not found in UBERON";

/** Disease annotations are free text, so they are grouped by name: healthy or
 * normal controls, cancers (in the lavender of cancer awareness), other diseases. */
export const DISEASE_GROUPS: (Group & { pattern: RegExp })[] = [
  { label: "Healthy or normal", pattern: /^(normal|healthy|control|healthy control|uninfected)$/i, slot: GREEN },
  {
    label: "Cancer",
    pattern: /cancer|carcinoma|tumou?r|neoplas|leuka?emia|lymphoma|sarcoma|melanoma|glioma|myeloma|blastoma|mesothelioma/i,
    slot: PURPLE,
  },
  { label: "Other disease", pattern: /./, slot: ORANGE },
];

export function diseaseGroup(name: string): string {
  return DISEASE_GROUPS.find((g) => g.pattern.test(name))!.label;
}

async function getJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// Looked-up groups are kept between sessions, so a dataset opened again is
// coloured at once and offline.
const STORE = "qpxui.chart-groups.v1";

/** One lookup per name; a failed one is tried again next time. */
function cached(kind: string, lookup: (name: string) => Promise<string>) {
  const cache = new Map<string, Promise<string>>();
  return (name: string): Promise<string> => {
    let found = cache.get(name);
    if (!found) {
      const key = `${STORE}:${kind}:${name}`;
      const hit = localStorage.getItem(key);
      found = (hit != null ? Promise.resolve(hit) : lookup(name).then((g) => (localStorage.setItem(key, g), g))).catch((e) => {
        cache.delete(name);
        throw e;
      });
      cache.set(name, found);
    }
    return found;
  };
}

async function taxon(query: string): Promise<any | null> {
  const params = new URLSearchParams({ query, fields: "scientific_name,common_name,lineage", format: "json", size: "1" });
  return (await getJSON(`${UNIPROT_TAXONOMY}?${params}`)).results?.[0] ?? null;
}

/** The taxonomic group of an organism; an entry listing several ("A; B") belongs to none. */
export const taxonGroup = cached("taxon", async (name) => {
  if (name.includes(";")) return SEVERAL_ORGANISMS;
  const hit = (await taxon(`scientific:"${name}"`)) ?? (await taxon(`"${name}"`));
  if (!hit) return NOT_IN_UNIPROT;
  const lineage = new Set<string>([hit.scientificName, ...(hit.lineage ?? []).map((l: any) => l.scientificName)]);
  return TAXON_GROUPS.find((g) => g.taxa.some((t) => lineage.has(t)))?.label ?? NOT_IN_UNIPROT;
});

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
const labelOf = (e: any): string => [e.label].flat()[0];
const curie = (iri: string) => iri.split("/").pop()!.replace("_", ":");

/** The exact label or synonym match, with its ancestors; the one whose label is
 * the name itself first ("Brain" is also a synonym of an insect ganglion). */
async function term(name: string, ontology: string): Promise<any | null> {
  const params = new URLSearchParams({ search: name, searchFields: "label synonym", exactMatch: "true", size: "20", lang: "en" });
  const found: any[] = (await getJSON(`${OLS}/${ontology}/classes?${params}`)).elements ?? [];
  return found.find((e) => norm(labelOf(e)) === norm(name)) ?? found[0] ?? null;
}

/** The organ system of a tissue or cell type. Cell types (CL, imported into
 * UBERON) and cell cultures (BTO) are not anatomy, so they form their own group. */
export const organSystem = cached("organ", async (name) => {
  const t = await term(name, "uberon");
  if (!t) return (await term(name, "bto")) ? CELLS : NOT_IN_UBERON;
  const ids = new Set<string>([t.curie, ...(t.hierarchicalAncestor ?? []).map(curie)]);
  const system = ORGAN_SYSTEMS.find((g) => g.ids.some((id) => ids.has(id)));
  if (system) return system.label;
  return t.curie.startsWith("CL:") ? CELLS : NO_SYSTEM;
});

/** Sample fields whose values belong to a biological group, how the group is
 * found, and what the group is (for chart subtitles). */
const GROUPED: Record<string, { groups: Group[]; lookup: (value: string) => Promise<string>; source: string }> = {
  [COL.organism_part]: { groups: ORGAN_SYSTEMS, lookup: organSystem, source: "organ system (UBERON)" },
  [COL.cell_type]: { groups: ORGAN_SYSTEMS, lookup: organSystem, source: "organ system (UBERON and CL)" },
  [COL.disease]: { groups: DISEASE_GROUPS, lookup: async (v) => diseaseGroup(v), source: "disease class" },
  [COL.organism]: { groups: TAXON_GROUPS, lookup: taxonGroup, source: "taxonomic group (UniProt)" },
};

/** What gives the hue of `field`'s values, when they belong to biological groups. */
export const groupSource = (field: string): string | undefined => GROUPED[field]?.source;

const UNANNOTATED = /^(not applicable|not available|unknown|pooled|none|n\/a|na)$/i;
/** Whether a sample's value is an annotation, not a placeholder for none. */
export const isAnnotated = (v: string) => v.trim() !== "" && !UNANNOTATED.test(v.trim());

/** Ordered stages, earliest first; a stage matching none goes last. */
const STAGES = [/embryo/i, /fet(al|us)/i, /neonat|newborn/i, /infant/i, /child/i, /juvenile/i, /adolescen/i, /adult/i, /aged|elderly|old/i];
const stageRank = (v: string) => {
  const i = STAGES.findIndex((re) => re.test(v));
  return i < 0 ? STAGES.length : i;
};
/** Fixed slots where a field has a small closed set of values. */
const FIXED: Record<string, Record<string, number>> = { [COL.sex]: { female: PURPLE, male: GREEN } };

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export interface ColourScale {
  colourOf: (value: string) => string;
  /** The values in legend order: by group, then by count; unannotated last. */
  order: string[];
}

/** The colours of the values of `field`, one entry of `values` per sample.
 * `groups` maps each value to its biological group once looked up. */
export function colourScale(field: string, values: string[], groups: Map<string, string> | null, t: ChartTheme = chartTheme()): ColourScale {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const ranked = [...counts.keys()].filter(isAnnotated).sort((a, b) => counts.get(b)! - counts.get(a)! || natural(a, b));
  const missing = [...counts.keys()].filter((v) => !isAnnotated(v)).sort(natural);
  const colours = new Map<string, string>();
  let order: string[];

  const grouped = GROUPED[field];
  if (grouped && groups) {
    // Hue = biological group, in the group table's order (grey groups last); shade = value.
    const slotOf = (g: string) => grouped.groups.find((x) => x.label === g)?.slot;
    const rank = (g: string) => {
      const i = grouped.groups.findIndex((x) => x.label === g);
      return i < 0 ? grouped.groups.length : i;
    };
    const families = new Map<string, string[]>();
    for (const v of ranked) {
      // A value newer than the lookup counts as outside the groups until it is answered.
      const g = groups.get(v) ?? NO_SYSTEM;
      families.set(g, [...(families.get(g) ?? []), v]);
    }
    const sorted = [...families].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
    // The grey groups share one run of shades, so no two of their values look alike.
    const greys = shades(t.other, sorted.filter(([g]) => slotOf(g) == null).reduce((n, [, m]) => n + m.length, 0));
    order = [];
    for (const [g, members] of sorted) {
      const slot = slotOf(g);
      const tones = slot == null ? greys.splice(0, members.length) : shades(t.cat[slot], members.length);
      members.forEach((v, i) => colours.set(v, tones[i]));
      order.push(...members);
    }
  } else if (field === COL.developmental_stage) {
    order = [...ranked].sort((a, b) => stageRank(a) - stageRank(b) || natural(a, b));
    ramp(order.length, t.cat[BLUE]).forEach((c, i) => colours.set(order[i], c));
  } else {
    // Fixed slots first, then the slots left by count; past them, grey ("other").
    const fixed = FIXED[field] ?? {};
    const fixedOf = (v: string) => fixed[v.toLowerCase()];
    const free = t.cat.filter((_, i) => !Object.values(fixed).includes(i));
    const open = ranked.filter((v) => fixedOf(v) == null);
    const room = ranked.length > t.cat.length ? free.length - 1 : free.length;
    for (const v of ranked) if (fixedOf(v) != null) colours.set(v, t.cat[fixedOf(v)]);
    open.slice(0, room).forEach((v, i) => colours.set(v, free[i]));
    order = [...ranked.filter((v) => colours.has(v)), ...ranked.filter((v) => !colours.has(v))];
  }

  const none = mix(t.other, t.bg, 0.45);
  return {
    colourOf: (v) => colours.get(v) ?? (isAnnotated(v) ? t.other : none),
    order: [...order, ...missing],
  };
}

/** The biological groups of the values of `field`, looked up as the field or
 * values change: null until they are known, and for a field without groups.
 * `failed` turns true when a lookup service could not be reached. */
export function useValueGroups(field: Ref<string>, values: Ref<string[]>) {
  const groups = ref<Map<string, string> | null>(null);
  const failed = ref(false);
  let latest = 0;
  // Keyed on the field and its distinct values, so a recomputed list with
  // the same values does not look them up again.
  const key = () => JSON.stringify([field.value, [...new Set(values.value)].sort()]);
  watch(
    key,
    async () => {
      const mine = ++latest;
      groups.value = null;
      failed.value = false;
      const grouped = GROUPED[field.value];
      if (!grouped) return;
      const names = [...new Set(values.value.filter(isAnnotated))];
      const found = await Promise.allSettled(names.map(grouped.lookup));
      if (mine !== latest) return;
      // Offline or a service down: the values keep the colours by count.
      if (found.some((r) => r.status === "rejected")) failed.value = true;
      else groups.value = new Map(names.map((n, i) => [n, (found[i] as PromiseFulfilledResult<string>).value]));
    },
    { immediate: true }
  );
  return { groups, failed };
}
