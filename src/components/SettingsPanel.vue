<script setup lang="ts">
// Settings modal: light/dark theme + per-PTM custom colours.
import {
  PTM_PALETTE,
  effectivePtmColor,
  resetPtmColor,
  setPtmColor,
  setTheme,
  settings,
} from "../lib/settings";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

function pick(id: string, e: Event) {
  const val = (e.target as HTMLInputElement).value;
  setPtmColor(id, val);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="panel" role="dialog" aria-label="Settings">
        <div class="head">
          <h3>Settings</h3>
          <button class="icon" @click="emit('close')" title="Close">✕</button>
        </div>

        <!-- Theme -->
        <section>
          <h4>Appearance</h4>
          <div class="theme-row">
            <button
              class="theme-btn"
              :class="{ on: settings.theme === 'dark' }"
              @click="setTheme('dark')"
            >
              🌙 Dark
            </button>
            <button
              class="theme-btn"
              :class="{ on: settings.theme === 'light' }"
              @click="setTheme('light')"
            >
              ☀️ Light
            </button>
          </div>
          <p class="hint">
            Applies to the whole application background and text. PTM colours below apply to
            both themes.
          </p>
        </section>

        <!-- PTM colours -->
        <section>
          <h4>PTM colours</h4>
          <p class="hint">
            Pick a colour for each modification family. Residues, short-code superscripts and
            the “modifications” pill badges all use these colours.
          </p>
          <div class="ptm-list">
            <div v-for="e in PTM_PALETTE" :key="e.id" class="ptm-row">
              <span class="swatch" :style="{ background: effectivePtmColor(e.id) }"></span>
              <span class="label">{{ e.label }}</span>
              <input
                type="color"
                class="picker"
                :value="effectivePtmColor(e.id)"
                @input="pick(e.id, $event)"
                :title="effectivePtmColor(e.id)"
              />
              <button
                class="reset"
                :disabled="!(e.id in settings.ptmColors)"
                :title="`Reset ${e.label} to default`"
                @click="resetPtmColor(e.id)"
              >
                ↺
              </button>
            </div>
          </div>
        </section>

        <div class="foot">
          <button class="primary" @click="emit('close')">Done</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.panel {
  width: min(520px, 100%);
  max-height: 88vh;
  overflow: auto;
  background: var(--bg-panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 22px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.head h3 {
  margin: 0;
}
.head .icon {
  padding: 4px 10px;
  font-size: 13px;
  line-height: 1.2;
}
section {
  margin-bottom: 22px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}
h4 {
  margin: 0 0 10px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
}
.hint {
  font-size: 11px;
  color: var(--text-dim);
  margin: 8px 0 12px;
  line-height: 1.5;
}
.theme-row {
  display: flex;
  gap: 10px;
}
.theme-btn {
  flex: 1;
}
.theme-btn.on {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.ptm-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow: auto;
}
.ptm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
}
.swatch {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  flex: none;
}
.label {
  flex: 1;
  font-size: 13px;
}
.picker {
  width: 40px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
.reset {
  padding: 3px 8px;
  font-size: 13px;
}
.foot {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}
</style>
