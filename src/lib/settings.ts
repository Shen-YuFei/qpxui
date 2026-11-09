// App settings: light/dark theme + per-PTM custom colours.
// Persisted to localStorage (survives restarts in the Tauri webview).
import { reactive } from "vue";

export type Theme = "dark" | "light";

export interface PTMEntry {
  /** Stable id used as the settings key. */
  id: string;
  /** Human label shown in the settings panel. */
  label: string;
  /** CV accessions that map to this modification (e.g. UNIMOD:21). */
  accessions: string[];
  /** Name substrings (lowercased) used to match non-accession names. */
  keywords: string[];
  /** Default colour when the user hasn't overridden it. */
  default: string;
}

// Default colours follow the portal's modification families: biological
// PTMs take categorical slots (phospho red, oxidation orange, acetyl violet,
// deamidation yellow, methyl pink, ubiquitin green, isobaric labels blue) and
// fixed or chemical modifications are grey, so they recede.
export const PTM_PALETTE: PTMEntry[] = [
  { id: "phospho", label: "Phosphorylation", accessions: ["UNIMOD:21"], keywords: ["phospho"], default: "#e34948" },
  { id: "oxidation", label: "Oxidation", accessions: ["UNIMOD:35"], keywords: ["oxid", "methion", "hydroxyl"], default: "#eb6834" },
  { id: "acetyl", label: "Acetylation", accessions: ["UNIMOD:1"], keywords: ["acetyl"], default: "#6250d6" },
  { id: "carbamidomethyl", label: "Carbamidomethyl", accessions: ["UNIMOD:4"], keywords: ["carbamidomethyl"], default: "#8b96a3" },
  { id: "carbamyl", label: "Carbamyl / Carbamylation", accessions: ["UNIMOD:5"], keywords: ["carbamyl"], default: "#a3acb6" },
  { id: "deamidated", label: "Deamidated", accessions: ["UNIMOD:7"], keywords: ["deamid", "deamidation"], default: "#eda100" },
  { id: "methyl", label: "Methylation", accessions: ["UNIMOD:34"], keywords: ["methyl", "methylation"], default: "#e87ba4" },
  { id: "dimethyl", label: "Dimethyl", accessions: ["UNIMOD:36"], keywords: ["dimethyl", "dethiomethyl"], default: "#c95b87" },
  { id: "trimethyl", label: "Trimethyl", accessions: ["UNIMOD:37"], keywords: ["trimethyl"], default: "#a8406b" },
  { id: "glygly", label: "GlyGly / Ubiquitination", accessions: ["UNIMOD:121"], keywords: ["gly", "ubiquit"], default: "#008300" },
  { id: "sulfation", label: "Sulfation", accessions: ["UNIMOD:40"], keywords: ["sulfo", "sulf"], default: "#1baf7a" },
  { id: "guanidinyl", label: "Guanidinyl", accessions: ["UNIMOD:52"], keywords: ["guanidin"], default: "#a3acb6" },
  { id: "isobaric", label: "Isobaric labels (TMT / iTRAQ / SILAC)", accessions: [], keywords: ["tmt", "itraq", "silac", "label:", "isotopic", "icat", "chelator", "piol"], default: "#2a78d6" },
  { id: "unknown", label: "Unknown / mass-shift", accessions: [], keywords: [], default: "#6b7785" },
];

const STORAGE_KEY = "qpxui.settings.v1";

export interface SettingsState {
  theme: Theme;
  /** entry.id -> colour override hex. */
  ptmColors: Record<string, string>;
}

function defaults(): SettingsState {
  return { theme: "light", ptmColors: {} };
}

function load(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    /* fall through to defaults */
  }
  return defaults();
}

export const settings = reactive<SettingsState>(load());

export function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Push the current theme onto <html> so the CSS variables switch. */
export function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.colorScheme = settings.theme;
}

export function setTheme(t: Theme) {
  settings.theme = t;
  applyTheme();
  persist();
}

export function setPtmColor(id: string, hex: string) {
  settings.ptmColors[id] = hex;
  persist();
}

/** Effective (user-overridden or default) colour for a palette entry. */
export function effectivePtmColor(id: string): string {
  return settings.ptmColors[id] ?? PTM_PALETTE.find((e) => e.id === id)!.default;
}

/** Reset one palette entry back to its default colour. */
export function resetPtmColor(id: string) {
  delete settings.ptmColors[id];
  persist();
}

/**
 * Resolve the colour shown for a modification, honouring user overrides.
 * 1) match by CV accession, 2) longest name keyword, 3) unknown fallback.
 */
export function resolvePtmColor(name?: string, accession?: string): string {
  const acc = (accession || "").toUpperCase();
  const byAcc = acc ? PTM_PALETTE.find((e) => e.accessions.includes(acc)) : undefined;
  if (byAcc) return effectivePtmColor(byAcc.id);
  const n = (name || "").toLowerCase();
  if (n.trim()) {
    let byKw: PTMEntry | undefined;
    let longest = 0;
    for (const entry of PTM_PALETTE) {
      for (const keyword of entry.keywords) {
        if (keyword.length > longest && n.includes(keyword)) {
          byKw = entry;
          longest = keyword.length;
        }
      }
    }
    if (byKw) return effectivePtmColor(byKw.id);
  }
  return effectivePtmColor("unknown");
}
