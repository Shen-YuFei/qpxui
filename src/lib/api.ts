import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface ViewInfo {
  name: string;
  view: string;
  format: string;
  path: string;
  sizeBytes: number;
}

export interface DatasetInfo {
  prefix: string;
  path: string;
  views: ViewInfo[];
  sourceKind: string;
}

export interface S3Object {
  key: string;
  sizeBytes: number;
  lastModified: string | null;
}

export interface S3Listing {
  bucket: string;
  prefix: string;
  objects: S3Object[];
  datasets: DatasetInfo[];
}

export interface PortalDataset {
  accession: string;
  title?: string | null;
  organism?: string | null;
  instrument?: string | null;
  samples?: number | null;
  proteins?: number | null;
  peptides?: number | null;
  psmCount?: number | null;
  totalSize?: number | null;
  datasetRef?: string | null;
  pxUrl?: string | null;
}

export interface StreamHandle {
  url: string;
  sizeBytes: number;
}

export interface StreamStat {
  sizeBytes: number;
  fetchedBytes: number;
  requests: number;
}

export const api = {
  /** Native file picker for a single QPX file. */
  chooseFile: (): Promise<string | null> =>
    open({
      multiple: false,
      filters: [{ name: "QPX", extensions: ["parquet", "tsv"] }],
    }) as Promise<string | null>,

  /** Native folder picker. */
  chooseFolder: (): Promise<string | null> =>
    open({ directory: true, multiple: false }) as Promise<string | null>,

  openFile: (path: string) => invoke<DatasetInfo>("open_file", { path }),

  scanFolder: (path: string) => invoke<DatasetInfo[]>("scan_folder", { path }),

  scanCollection: (path: string) => invoke<DatasetInfo[]>("scan_collection", { path }),

  listS3: (bucket: string, prefix?: string) =>
    invoke<S3Listing>("list_s3", { bucket, prefix }),

  cacheS3Views: (bucket: string, paths: string[], cancelId?: string) =>
    invoke<ViewInfo[]>("cache_s3_views", { bucket, paths, cancelId }),

  /** Sign S3 paths so DuckDB can read them lazily over HTTP without credentials. */
  presignS3Urls: (bucket: string, paths: string[]) =>
    invoke<Record<string, string>>("presign_s3_urls", { bucket, paths }),
  /** Register S3 views with the backend range proxy (lazy, no download). */
  streamS3Urls: (bucket: string, paths: string[]) =>
    invoke<Record<string, StreamHandle>>("stream_s3_urls", { bucket, paths }),
  /** Bytes actually fetched from S3 per streamed view (keyed by s3:// path). */
  streamS3Stats: () => invoke<Record<string, StreamStat>>("stream_s3_stats"),

  /** Ask the backend to abort an in-flight download batch. */
  cancelDownload: (id: string) => invoke<void>("cancel_download", { id }),

  readFileBytes: (path: string) => invoke<string>("read_file_bytes", { path }),

  // ---- quantms portal (public example source over HTTPS) ----
  portalDatasets: (limit?: number) => invoke<string[]>("portal_datasets", { limit }),
  portalRegistry: (pageSize?: number) =>
    invoke<PortalDataset[]>("portal_registry", { pageSize }),
  portalListViews: (dataset: string) => invoke<ViewInfo[]>("portal_list_views", { dataset }),
  portalCacheViews: (urls: string[], cancelId?: string) =>
    invoke<ViewInfo[]>("portal_cache_views", { urls, cancelId }),
};
