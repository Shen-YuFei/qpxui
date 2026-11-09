<script setup lang="ts">
// One sample characteristic as a bar per value, each bar in its value's
// biological colour (see lib/sampleColours.ts).
import { computed, toRef } from "vue";
import ChartCard from "../ChartCard.vue";
import type { ChartSpec } from "../../lib/charts";
import { colourScale, groupSource, useValueGroups } from "../../lib/sampleColours";
import { settings } from "../../lib/settings";

const props = defineProps<{ col: string; spec: ChartSpec; fileBase: string }>();

/** One entry per sample, as the colour scale counts them. */
const values = computed(() => props.spec.labels.flatMap((v, i) => Array<string>(Number(props.spec.series[0].values[i]) || 0).fill(v)));
const { groups, failed } = useValueGroups(toRef(props, "col"), values);

const coloured = computed<ChartSpec>(() => {
  void settings.theme;
  const scale = colourScale(props.col, values.value, groups.value);
  return { ...props.spec, colors: props.spec.labels.map((v) => scale.colourOf(v)) };
});

const subtitle = computed(() => {
  const by = groupSource(props.col);
  if (by && groups.value) return `Samples per value (top 25); hue = ${by}.`;
  if (by && failed.value) return "Samples per value (top 25); biological groups unavailable, colours by count.";
  return "Samples per value (top 25).";
});
</script>

<template>
  <ChartCard
    :title="col.replace(/_/g, ' ')"
    :subtitle="subtitle"
    :spec="coloured"
    :file-base="fileBase"
    :height="Math.max(140, Math.min(25, spec.labels.length) * 22 + 40)"
  />
</template>
