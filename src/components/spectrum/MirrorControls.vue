<script setup lang="ts">
// The spectrum viewer's mirror row: what to draw below the PSM, the choice
// of PSM, Koina model or USI, and the similarity of the two spectra.
import { KOINA_MODELS } from "../../lib/mirror";
import { psmLabel } from "../../lib/queries/spectrum";
import type { MirrorMode } from "../../lib/useMirror";

defineProps<{
  otherPsms: Record<string, any>[];
  busy: boolean;
  error: string;
  koinaWhy: string;
  sim: { cosine: number; angle: number; matched: number } | null;
}>();
const emit = defineEmits<{ (e: "load"): void }>();
const mode = defineModel<MirrorMode>("mode", { required: true });
const otherIdx = defineModel<number>("otherIdx", { required: true });
const koinaModel = defineModel<string>("koinaModel", { required: true });
const nce = defineModel<number>("nce", { required: true });
const usiInput = defineModel<string>("usiInput", { required: true });
</script>

<template>
  <div class="controls mirror-row">
    <label title="Draw a reference spectrum mirrored below the PSM">
      Mirror
      <select v-model="mode">
        <option value="none">none</option>
        <option value="psm">another PSM of this peptidoform</option>
        <option value="predicted">predicted (Koina)</option>
        <option value="usi">spectrum by USI</option>
        <option value="theoretical">theoretical b/y ions</option>
      </select>
    </label>
    <template v-if="mode === 'psm'">
      <select v-model.number="otherIdx" class="wide" :disabled="!otherPsms.length">
        <option v-if="!otherPsms.length" :value="-1">{{ busy ? "searching…" : "no other PSM" }}</option>
        <option v-for="(o, k) in otherPsms.slice(0, 200)" :key="k" :value="k">{{ psmLabel(o) }}</option>
      </select>
      <span v-if="otherPsms.length" class="muted">{{ otherPsms.length > 200 ? "200+" : otherPsms.length }} other PSMs</span>
    </template>
    <template v-else-if="mode === 'predicted'">
      <select v-model="koinaModel" title="Prediction model served by Koina (koina.wilhelmlab.org)">
        <option v-for="m in KOINA_MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
      </select>
      <label v-if="KOINA_MODELS.find((m) => m.id === koinaModel)?.ce">NCE
        <input v-model.number="nce" type="number" min="10" max="50" class="num" @change="emit('load')" />
      </label>
      <span v-if="koinaWhy" class="warn">{{ koinaWhy }}</span>
      <span v-else class="muted" title="The peptide sequence is sent to koina.wilhelmlab.org">via Koina</span>
    </template>
    <template v-else-if="mode === 'usi'">
      <input v-model="usiInput" class="mono usi-in" placeholder="mzspec:PXD…:run:scan:N:PEPTIDE/2" @keyup.enter="emit('load')" />
      <button class="xs" :disabled="busy" @click="emit('load')">Load</button>
    </template>
    <span v-if="busy" class="muted"><span class="spinner"></span></span>
    <span v-if="error" class="error">{{ error }}</span>
    <span v-if="sim" class="sim" title="Cosine of square-root intensities after one-to-one peak matching; SA = normalised spectral angle">
      cosine <b>{{ sim.cosine.toFixed(3) }}</b> · SA <b>{{ sim.angle.toFixed(3) }}</b> · {{ sim.matched }} matched peaks
    </span>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  align-items: center;
  font-size: 13px;
}
.controls label {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.num {
  width: 64px;
}
.mirror-row .wide {
  max-width: 520px;
}
.usi-in {
  flex: 1;
  min-width: 320px;
  font-size: 12px;
}
.sim {
  margin-left: auto;
  color: var(--text-dim);
}
.sim b {
  color: var(--text);
}
.warn {
  font-size: 13px;
  color: var(--warn);
}
.error {
  color: var(--err);
}
</style>
