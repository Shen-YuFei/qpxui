<script setup lang="ts">
// Rich, nested rendering for expanded structured cells (STRUCT / LIST / MAP).
// Special-cases the common QPX shapes:
//   * `scores` / `additional_scores`  [{score_name, score_value, higher_better}, …]
//                                       -> tight "score_name = score_value" rows
//   * `modifications`                 [{name, accession, positions:[…]}, …]
//                                       -> one colour-coded card per modification
//   * anything else                    -> a generic indented key/value tree
import { computed } from "vue";
import { isStructured, scalarText } from "../lib/format";
import { ptmColor, ptmMeta, shortCode } from "../lib/ptm";

defineOptions({ name: "StructuredView" });

const props = defineProps<{
  value: unknown;
  /** Show the little type-label header (only at the top level). */
  root?: boolean;
}>();

// ---- classifiers ----
/** Is this a scores list: array of objects each carrying score_name? */
function isScores(v: unknown): v is Array<Record<string, unknown>> {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => isStructured(x) && "score_name" in (x as object))
  );
}
/** Is this a modifications list: array of objects each carrying name + accession? */
function isMods(v: unknown): v is Array<Record<string, unknown>> {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => isStructured(x) && "name" in (x as object))
  );
}

const kind = computed<string>(() => {
  const v = props.value;
  if (isScores(v)) return "scores";
  if (isMods(v)) return "modifications";
  if (Array.isArray(v)) return "list";
  if (isStructured(v)) return "struct";
  return "value";
});
const kindHint = computed<string>(() => {
  switch (kind.value) {
    case "scores":
      return "scores — higher/lower-is-better marked ▲/▼";
    case "modifications":
      return "post-translational modifications, colour-coded";
    case "list":
      return "nested list value";
    case "struct":
      return "structured record";
    default:
      return "";
  }
});

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== "object" || !isStructured(v);
}

// ---- PTM helpers for the modifications cards ----
function modName(m: Record<string, unknown>): string {
  return (m.name as string) || "Modification";
}
function modAcc(m: Record<string, unknown>): string | undefined {
  const acc = m.accession as string | undefined;
  const meta = ptmMeta(modName(m), acc);
  return meta?.accession ?? acc ?? undefined;
}
function modMass(m: Record<string, unknown>): string | null {
  const meta = ptmMeta(modName(m), m.accession as string | undefined);
  return meta ? `${meta.mass >= 0 ? "+" : ""}${meta.mass.toFixed(4)} Da` : null;
}
function modPositions(m: Record<string, unknown>): Array<{ pos: number; aa: string | null }> {
  const poss = m.positions as Array<{ position?: number; amino_acid?: string | null }> | undefined;
  if (!Array.isArray(poss)) return [];
  return poss
    .filter((p) => typeof p?.position === "number")
    .map((p) => ({ pos: p.position as number, aa: (p.amino_acid as string | null) ?? null }));
}

// ---- scores row rendering ----
function scoreLabel(m: Record<string, unknown>): string {
  return String(m.score_name ?? "score");
}
function scorePairs(m: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(m).filter(([k]) => k !== "score_name" && k !== "higher_better");
}
</script>

<template>
  <div class="sv">
    <div v-if="root" class="sv-kind">
      <span class="sv-kind-chip">{{ kind }}</span>
      <span class="sv-kind-hint">{{ kindHint }}</span>
    </div>
    <!-- Empty -->
    <span v-if="Array.isArray(value) && value.length === 0" class="sv-muted">∅ (empty list)</span>
    <span v-else-if="isStructured(value) && Object.keys(value).length === 0" class="sv-muted">{ }</span>

    <!-- Scores: score_name = score_value -->
    <div v-else-if="isScores(value)" class="sv-scores">
      <div v-for="(m, i) in value" :key="i" class="sv-score">
        <span class="sv-score-label">{{ scoreLabel(m) }}</span>
        <span v-for="[k, val] in scorePairs(m)" :key="k" class="sv-pair">
          <span class="sv-key">{{ k }}</span>
          <span class="sv-scalar">{{ scalarText(val) }}</span>
        </span>
        <span v-if="m.higher_better === true" class="sv-hb" title="higher is better">▲</span>
        <span v-else-if="m.higher_better === false" class="sv-hb" title="lower is better">▼</span>
      </div>
    </div>

    <!-- Modifications: one colour-coded card each -->
    <div v-else-if="isMods(value)" class="sv-mods">
      <div v-for="(m, i) in value" :key="i" class="sv-mod">
        <span class="sv-mod-head">
          <span class="ptm-badge" :style="{ '--ptm': ptmColor(modName(m), modAcc(m)) }">
            <span class="ptm-badge-dot"></span>{{ shortCode(modName(m), modAcc(m)) }}
          </span>
          <span class="sv-mod-name">{{ modName(m) }}</span>
          <span class="sv-mod-acc">{{ modAcc(m) }}</span>
          <span class="sv-mod-mass">{{ modMass(m) }}</span>
        </span>
        <div v-if="modPositions(m).length" class="sv-mod-pos">
          <span v-for="(p, j) in modPositions(m)" :key="j" class="sv-mod-pos-chip">
            {{ p.aa ?? "?" }}<sub>{{ p.pos }}</sub>
          </span>
        </div>
      </div>
    </div>

    <!-- Generic LIST -->
    <div v-else-if="Array.isArray(value)" class="sv-list">
      <template v-if="value.every(isScalar)">
        <span class="sv-inline">[ {{ value.map((v) => scalarText(v)).join(", ") }} ]</span>
      </template>
      <div v-else class="sv-items">
        <div v-for="(item, i) in value" :key="i" class="sv-item">
          <span class="sv-idx">{{ i }}</span>
          <StructuredView :value="item" :root="false" />
        </div>
      </div>
    </div>

    <!-- Generic STRUCT -->
    <div v-else-if="isStructured(value)" class="sv-object">
      <div v-for="(val, key) in value" :key="key" class="sv-row">
        <span class="sv-key">{{ key }}</span>
        <StructuredView v-if="!isScalar(val)" :value="val" :root="false" />
        <span v-else class="sv-scalar">{{ scalarText(val) }}</span>
      </div>
    </div>

    <!-- Scalar -->
    <span v-else class="sv-scalar">{{ scalarText(value) }}</span>
  </div>
</template>

<style scoped>
.sv {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text);
}
.sv-kind {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.sv-kind-chip {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  padding: 2px 8px;
  border-radius: 999px;
}
.sv-kind-hint {
  font-size: 10px;
  color: var(--muted, #94a3b8);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.sv-muted {
  color: var(--muted, #94a3b8);
}
.sv-inline {
  word-break: break-all;
}

/* scores */
.sv-scores {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sv-score {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.sv-score-label {
  font-weight: 700;
  color: var(--accent);
  min-width: 120px;
}
.sv-pair {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
}
.sv-hb {
  font-size: 9px;
  color: var(--ptm, var(--accent));
  opacity: 0.8;
}

/* modifications */
.sv-mods {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sv-mod {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-soft);
}
.sv-mod-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sv-mod-name {
  font-weight: 700;
}
.sv-mod-acc,
.sv-mod-mass {
  color: var(--muted, #94a3b8);
  font-size: 10px;
}
.sv-mod-pos {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.sv-mod-pos-chip {
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 700;
  background: rgba(148, 163, 184, 0.15);
  border: 1px solid rgba(148, 163, 184, 0.25);
}
.sv-mod-pos-chip sub {
  font-size: 8px;
  margin-left: 1px;
  opacity: 0.7;
}

/* colour-coded modification pills (shared look with the browse tables) */
.ptm-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 700;
  padding: 0 6px;
  border-radius: 999px;
  color: var(--ptm);
  background: color-mix(in srgb, var(--ptm) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--ptm) 45%, transparent);
  line-height: 1.4;
}
.ptm-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ptm);
}

/* generic list */
.sv-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sv-item {
  display: flex;
  gap: 8px;
}
.sv-idx {
  color: var(--muted, #94a3b8);
  min-width: 22px;
  text-align: right;
  user-select: none;
}

/* generic struct */
.sv-object {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sv-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.sv-key {
  color: var(--muted, #94a3b8);
  min-width: 90px;
  text-align: right;
}
.sv-scalar {
  word-break: break-word;
}
</style>
