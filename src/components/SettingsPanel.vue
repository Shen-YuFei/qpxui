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
          <div class="theme-row" role="radiogroup" aria-label="Theme">
            <button class="theme-btn" :class="{ on: settings.theme === 'light' }" @click="setTheme('light')">Light</button>
            <button class="theme-btn" :class="{ on: settings.theme === 'dark' }" @click="setTheme('dark')">Dark</button>
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
            Pick a colour for each modification family. Modified residues are tinted and underlined
            in it, and the badges in the modifications column carry it as a dot.
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
  background: var(--scrim);
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
  border-radius: var(--radius);
  padding: 20px 22px;
  box-shadow: var(--shadow);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.head h3 {
  margin: 0;
  font-size: 18px;
}
.head .icon {
  padding: 3px 9px;
  font-size: 13px;
  line-height: 1.2;
}
section {
  margin-bottom: 20px;
  border-top: 1px solid var(--rule);
  padding-top: 14px;
}
h4 {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--text);
}
.hint {
  font-size: 12.5px;
  color: var(--muted);
  margin: 8px 0 12px;
  line-height: 1.5;
}
/* A two-way segmented control. */
.theme-row {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.theme-btn {
  border: none;
  border-radius: 0;
  padding: 6px 22px;
  background: var(--bg-panel);
  color: var(--text-dim);
}
.theme-btn + .theme-btn {
  border-left: 1px solid var(--border);
}
.theme-btn.on {
  background: var(--accent);
  color: var(--on-accent);
}
.theme-btn.on:hover:not(:disabled) {
  color: var(--on-accent);
}
.ptm-list {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow: auto;
  border-top: 1px solid var(--rule);
}
.ptm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px;
  border-bottom: 1px solid var(--rule);
}
.swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex: none;
}
.label {
  flex: 1;
  font-size: 13px;
}
.picker {
  width: 40px;
  height: 26px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
.reset {
  padding: 2px 8px;
  font-size: 13px;
}
.foot {
  display: flex;
  justify-content: flex-end;
  padding-top: 6px;
}
</style>
