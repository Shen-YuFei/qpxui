# QPX UI

A **local desktop viewer** for the [QPX (Quantitative Proteomics eXchange)](https://github.com/bigbio/qpx)
format, built with [Tauri v2](https://v2.tauri.app/), **Vue 3 + TypeScript + Vite**,
and [DuckDB](https://duckdb.org) (running in-browser via `duckdb-wasm`).

QPX datasets are folders of `<prefix>.<view>.parquet` files (e.g.
`PXD021013.feature.parquet`, `PXD021013.pg.parquet`, `PXD021013.dataset.parquet`). This app lets
you browse, query interactively, and summarise that data **entirely on your machine** — you can
open a single file, a dataset folder, a collection of many projects, or a remote S3 bucket.

---

## Features

| Source | What it does |
|--------|--------------|
| **Single file** | Open one `*.parquet` view and its sibling views in the same folder. |
| **Folder / collection** | Point at one QPX dataset folder, or a folder tree holding many projects (`PXD*/`). |
| **S3 bucket** | List datasets in a bucket/prefix via your AWS credential chain, download the chosen parquet views to a local cache once, then query offline. |

For a loaded view you get three tabs:

- **Browse** — paginated table (500 rows/page) with column sorting and a live `WHERE` filter.
- **Summary** — auto-generated charts: charge/peptide distributions, top protein groups,
  per-run counts, q-value distributions, plus a histogram for any numeric column.
- **Query** — write **SQL** against the view (DuckDB dialect, the same engine the qpx CLI uses),
  or run one of the quick-example queries.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  WebView (Vue 3 + Vite + duckdb-wasm)                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ ┌─────────┐ │
│  │ SourcePicker│  │  Explorer  │  │  Summary   │ │  Query  │ │
│  │ file/folder/│  │ (views)    │  │ (ECharts)  │ │  (SQL)  │ │
│  │  S3         │  └─────┬──────┘  └─────┬──────┘ └────┬────┘ │
│  └──────┬──────┘        │               │             │      │
│         │   Tauri IPC (invoke)          │             │      │
└─────────┼───────────────────────────────┼─────────────┼──────┘
          ▼                               ▼             ▼
┌──────────────────────────────────────────────────────────────┐
│  Tauri (Rust) backend                                          │
│  • open_file / scan_folder / scan_collection  (QPX discovery) │
│  • read_file_bytes                         (base64 → bytes)   │
│  • list_s3 / cache_s3_views  (aws-sdk-s3, rustls)             │
└──────────────────────────────────────────────────────────────┘
              (query engine: DuckDB runs inside the webview)
```

Design notes:
- **Local file access + S3** live in Rust; **all SQL / summarisation / charting** happens in the
  webview with DuckDB, so queries are interactive and nothing leaves your machine (except the
  one-time S3 downloads you explicitly trigger).
- S3 views are downloaded into the OS cache dir (`~/Library/Caches/qpxui/s3-cache`), so
  subsequent queries are offline.
- The DuckDB WASM + worker binaries are bundled locally via Vite (no CDN) — the app works offline.

---

## Prerequisites

- **Node.js 20+** and npm (or your preferred package manager)
- **Rust** toolchain (rustup): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Tauri system dependencies** — on macOS only Xcode Command Line Tools are needed
  (`xcode-select --install`). On Windows install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/);
  on Linux the [webkit2gtk stack](https://v2.tauri.app/start/prerequisites/).

---

## Getting started

```bash
# 1. install JS deps
npm install

# 2. build & run the desktop app (compiles the Rust backend too)
npm run tauri dev
```

To produce a distributable bundle (`.app` / `.msi` / `.deb`…):

```bash
npm run tauri build
```

The bundled binaries are written to `src-tauri/target/release/bundle/`.

---

## Getting sample QPX data

Any of these give you real parquet views to play with:

```bash
# (a) quick: a tiny example dataset shipped with this repo
node scripts/fetch-sample.mjs        # downloads a small PXD example folder into ./sample

# (b) convert your own MaxQuant / DIA-NN / Spectronaut output:
pip install "qpx[all]"
qpxc convert diann --report-path report.tsv --sdrf-file data.sdrf.tsv --output-folder ./sample/PXD000000
qpxc convert maxquant --msms-file msms.txt --output-folder ./sample/PXD000000
```

> Pre-converted datasets (e.g. `PXD014414`) are also published through the
> [quantms QPX explore](https://portal.quantms.org/apps/qpx-explore) portal — download the
> folder's `*.parquet` files into one directory and open that directory in the app.

---

## S3 usage

The S3 mode uses the **default AWS credential chain** (env vars, `~/.aws/credentials`, or an IAM
role — as configured for the AWS SDK). Example:

```
AWS_PROFILE=myprod AWS_REGION=eu-west-1 npm run tauri dev
```

In the app: **New source → S3 bucket**, enter the bucket name and an optional prefix, click
**List**, tick the views you want, then **Load selected**. The chosen parquet files are cached
locally and queryable straight away.

---

## Notes & limitations

- The reference qpx query engine is DuckDB; this app uses DuckDB too, so `SELECT`, aggregations,
  `list/struct` slicing, etc. behave like `qpxc query sql`.
- Matrices in AnnData/HDF5 format (`.ae.h5ad`, `.de.h5ad`, `.h5mu`) are listed but not yet
  rendered — the current viewer focuses on the Parquet views. That can be extended later.
- Large views (especially `mz`/spectra) are loaded into the webview's memory when queried; for
  very large files the DuckDB WASM engine may be limited. Paging/Browse helps keep memory in check.
- Icons: `src-tauri/icons/icon.png` is a placeholder — replace with a proper 512×512 app icon
  before shipping a release bundle.

---

## Project layout

```
qpxui/
├── index.html
├── vite.config.ts
├── src/
│   ├── App.vue                  # shell: topbar + sidebar + panel
│   ├── store.ts                 # reactive app state
│   ├── lib/
│   │   ├── api.ts               # Tauri IPC wrappers + types
│   │   └── duck.ts              # DuckDB init + query helpers
│   └── components/
│       ├── SourcePicker.vue     # open file / folder / collection
│       ├── S3Picker.vue         # S3 list + load
│       ├── DatasetExplorer.vue  # sidebar: datasets + views
│       ├── ViewPanel.vue        # tabs: Browse / Summary / Query
│       ├── DataTable.vue        # paginated, sortable table w/ WHERE
│       ├── SummaryView.vue      # auto-summary charts (ECharts)
│       └── QueryView.vue        # SQL editor + results
├── scripts/
│   └── fetch-sample.mjs         # downloads a small example dataset
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── icons/icon.png
    └── src/
        ├── main.rs / lib.rs     # Tauri bootstrap
        ├── qpx/mod.rs           # QPX filename/discovery logic
        └── commands/            # Rust commands (sources, io, s3)
```

## License

Apache-2.0.
