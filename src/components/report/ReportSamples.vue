<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import ChartCard from "../ChartCard.vue";
import ReportTable from "../ReportTable.vue";
import type { Column } from "../../lib/report";
import type { DatasetInfo } from "../../lib/api";
import type { ChartSpec } from "../../lib/charts";
import { cachedSql, ident, objects, type DatasetTables } from "../../lib/report";
import { SAMPLE_FACETS } from "../../lib/qpx";

const props = defineProps<{ ds: DatasetInfo; t: DatasetTables; fileBase: string }>();

const busy = ref(true);
const error = ref("");
const rows = ref<Record<string, any>[]>([]);
const facets = ref<{ col: string; spec: ChartSpec }[]>([]);
const q = ref("");
const table = ref<InstanceType<typeof ReportTable> | null>(null);

const sample = props.t.sample;
const runV = props.t.run;

const columns = computed<Column[]>(() => {
  if (!rows.value.length) return [];
  return Object.keys(rows.value[0])
    .filter((k) => rows.value.some((r) => r[k] !== null && r[k] !== "" && r[k] !== undefined))
    .map((k) => ({ key: k, label: k.replace(/_/g, " "), num: typeof rows.value[0][k] === "number" }));
});

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return rows.value;
  return rows.value.filter((r) => Object.values(r).some((v) => v !== null && String(v).toLowerCase().includes(s)));
});

onMounted(async () => {
  try {
    if (sample) {
      // Attach how many runs / which channels each sample was measured in.
      const hasMap = !!runV?.cols.has("samples");
      const sql = hasMap
        ? `WITH m AS (
             SELECT s.sample_accession AS sample_accession, count(DISTINCT run_file_name)::BIGINT AS runs,
                    string_agg(DISTINCT s.label, ', ') AS labels
             FROM (SELECT run_file_name, unnest(samples) AS s FROM ${ident(runV!.table)}) GROUP BY 1)
           SELECT x.*, m.runs, m.labels FROM ${ident(sample.table)} x LEFT JOIN m USING (sample_accession)`
        : `SELECT * FROM ${ident(sample.table)}`;
      const r = await cachedSql(props.ds, "smp.rows", sql, 50000);
      rows.value = objects(r).sort((a, b) =>
        String(a.sample_accession ?? "").localeCompare(String(b.sample_accession ?? ""), undefined, { numeric: true })
      );
      for (const col of SAMPLE_FACETS) {
        if (!sample.cols.has(col)) continue;
        const f = await cachedSql(
          props.ds,
          `smp.f.${col}`,
          `SELECT coalesce(${ident(col)}, 'not available') AS k, count(*)::BIGINT AS n FROM ${ident(sample.table)} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`
        );
        // A single value (e.g. all "Homo sapiens") is shown in the header/table already.
        if (f.rows.length < 2) continue;
        facets.value.push({
          col,
          spec: {
            kind: "hbar",
            labels: f.rows.map((x) => String(x[0])),
            series: [{ name: "samples", values: f.rows.map((x) => Number(x[1])) }],
            xName: "samples",
          },
        });
      }
    } else if (runV) {
      // modification_parameters is optional in the QPX run view.
      const cols = runV.cols.has("modification_parameters") ? "* EXCLUDE (modification_parameters)" : "*";
      const r = await cachedSql(props.ds, "smp.runs", `SELECT ${cols} FROM ${ident(runV.table)}`, 50000);
      rows.value = objects(r);
    }
  } catch (e: any) {
    error.value = String(e?.message ?? e);
  } finally {
    busy.value = false;
  }
});

</script>

<template>
  <div>
    <div v-if="!sample && !runV" class="muted pad">No sample or run view in this dataset.</div>
    <div v-else-if="error" class="error pad">⚠ {{ error }}</div>
    <div v-else-if="busy" class="muted pad">Loading samples… <span class="spinner"></span></div>
    <template v-else>
      <div v-if="facets.length" class="grid">
        <ChartCard
          v-for="f in facets"
          :key="f.col"
          :title="f.col.replace(/_/g, ' ')"
          subtitle="Samples per value (top 25)."
          :spec="f.spec"
          :file-base="fileBase"
          :height="Math.max(140, Math.min(25, f.spec.labels.length) * 22 + 40)"
        />
      </div>
      <div class="sec">
        <div class="sec-head">
          <h3>{{ sample ? "Samples" : "Runs" }} <span class="muted">({{ filtered.length.toLocaleString() }} of {{ rows.length.toLocaleString() }})</span></h3>
          <div class="acts">
            <input v-model="q" placeholder="Filter…" class="filter" />
            <button class="xs" :disabled="!rows.length" @click="table?.exportCsv()">CSV</button>
          </div>
        </div>
        <ReportTable ref="table" :columns="columns" :rows="filtered" :file-name="`${fileBase}_${sample ? 'samples' : 'runs'}`" max-height="560px" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.sec {
  margin-top: 18px;
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 10px;
}
.acts {
  display: flex;
  gap: 6px;
  align-items: center;
}
.filter {
  padding: 4px 8px;
  font-size: 12px;
  width: 220px;
}
h3 {
  margin: 0;
  font-size: 14px;
}
button.xs {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 6px;
}
.pad {
  padding: 18px;
}
</style>
