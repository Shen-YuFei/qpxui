# QPX UI

A **local desktop viewer** for the [QPX (Quantitative Proteomics eXchange)](https://github.com/bigbio/qpx)
format, built with [Tauri v2](https://v2.tauri.app/), **Vue 3 + TypeScript + Vite**,
and [DuckDB](https://duckdb.org) (running in-browser via `duckdb-wasm`).

QPX datasets are folders of `<prefix>.<view>.parquet` files (e.g.
`PXD021013.feature.parquet`, `PXD021013.pg.parquet`, `PXD021013.dataset.parquet`). This app lets
you browse, query interactively, and summarise that data **entirely on your machine** — you can
open a single file, a dataset folder, a collection of many projects, or a remote S3 bucket.

---

## Install

Download the installer for your platform from the
[latest release](https://github.com/bigbio/qpxui/releases/latest):

| Platform | File | Notes |
|----------|------|-------|
| macOS (Apple Silicon / Intel) | `qpxui_<version>_aarch64.dmg` / `_x64.dmg` | Open the `.dmg` and drag **qpxui** to Applications. |
| Windows | `qpxui_<version>_x64-setup.exe` or `.msi` | Run the installer (uses the WebView2 runtime that ships with Windows 10/11). |
| Linux | `.AppImage`, `.deb`, `.rpm` | `chmod +x *.AppImage && ./qpxui*.AppImage`, or install the `.deb`/`.rpm`. |

> **macOS unsigned-app note:** the builds aren't notarized yet, so the first launch may say the
> app "is damaged" or "can't be opened". Right-click the app → **Open**, or run
> `xattr -dr com.apple.quarantine /Applications/qpxui.app`.

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

### Dataset report & search

Selecting a dataset that has a `feature`, `psm` or `pg` view opens its **report** (also reachable
from **📈 Report & search** in the sidebar). The header shows the project metadata, KPI cards and a
**Cite this data** box (copy, BibTeX, RIS). Tabs appear only when the dataset has the data for them:

- **Overview** — identifications per run, charge, peptide length, missed cleavages, peptides per
  protein group, precursor mass error, retention time, intensity, PEP and q-value distributions.
- **QC** — per-run identifications, median intensity and mass error per run (to spot drift),
  per-sample intensity boxplots (TMT channels mapped to samples via the run view), and a per-run table.
- **PTMs** — modification landscape in your PTM colours, sites by residue, modifications per
  peptide. Click a modification to list its peptides.
- **Samples** — sample metadata facets and a filterable sample table.
- **Proteins** — search by accession, protein or gene name. A detail pane shows UniProt links,
  per-run evidence and the PTM-coloured peptides.
- **Peptides** — sequence search (contains / starts with / exact, or peptidoform text such as
  `M[Oxidation]`), with modification and charge filters and per-run evidence for each peptidoform.

The sidebar search box searches the selected dataset. An upper-case amino-acid string of 8 or more
residues is treated as a peptide. Every chart and table exports to PNG/CSV. Queries read only the
columns they need and leave out decoys, so streamed S3/portal datasets download just those column chunks.

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
**List**, tick the views you want, then choose:

- **⚡ Stream (lazy, no download)**: query the files in place. The Rust backend runs a
  `127.0.0.1` HTTP range proxy (`src-tauri/src/commands/s3stream.rs`). DuckDB reads only the
  parquet footer plus the column chunks / row groups each query touches, and the proxy fetches
  just those byte ranges from S3 with your credentials, keeping them in a 512 MB in-memory block
  cache. Buckets need no CORS setup, and credentials never reach the webview. The sidebar shows
  how much of each file has actually been fetched (e.g. `⚡ 16 MB / 170 MB`).
- **Download to cache**: fetch whole files once (with progress + cancel) for fully offline use.

S3-compatible stores (MinIO, Ceph, …) work via `AWS_ENDPOINT_URL=http://host:9000`.

The **quantms portal** source has the same two buttons. Streaming portal files goes through the
same proxy: it follows the portal's redirect to a short-lived signed storage URL (and re-resolves
it when it expires), then fetches only the byte ranges each query needs. No credentials needed.
Large reads are split into 4 MB range requests fetched 8 at a time.

---

## Notes & limitations

- The reference qpx query engine is DuckDB; this app uses DuckDB too, so `SELECT`, aggregations,
  `list/struct` slicing, etc. behave like `qpxc query sql`.
- Matrices in AnnData/HDF5 format (`.ae.h5ad`, `.de.h5ad`, `.h5mu`) are listed but not yet
  rendered — the current viewer focuses on the Parquet views. That can be extended later.
- Large views (especially `mz`/spectra) are loaded into the webview's memory when queried; for
  very large files the DuckDB WASM engine may be limited. Paging/Browse helps keep memory in check.
- Icons are generated from `src-tauri/icons/icon-source.png` (drawn by `scripts/make-icon.py`)
  with `npx tauri icon src-tauri/icons/icon-source.png`.

## Releasing

Push a version tag. The `Release` GitHub Actions workflow then builds the macOS (arm64 + x64),
Windows and Linux installers and attaches them to a draft release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

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
