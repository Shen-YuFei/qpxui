//! Emit download progress to the frontend via Tauri events, so the UI can
//! show live progress bars while parquet views are being transferred from
//! S3 or the quantms portal into the local cache.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event name the frontend listens for.
pub const EVENT: &str = "download-progress";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// The download batch's `cancelId`, so the frontend can tell batches apart.
    pub download: String,
    /// Parquet file name (key the frontend uses to index the progress map).
    pub file: String,
    /// Bytes transferred so far.
    pub done: u64,
    /// Total bytes, or 0 when unknown (indeterminate).
    pub total: u64,
    /// 0..100 fraction done.
    pub percent: f64,
    /// `downloading` | `done`.
    pub phase: String,
}

impl DownloadProgress {
    fn chunk(download: &str, file: &str, done: u64, total: u64) -> Self {
        let percent = if total > 0 {
            (done as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        DownloadProgress {
            download: download.to_string(),
            file: file.to_string(),
            done,
            total,
            percent,
            phase: "downloading".to_string(),
        }
    }

    fn done(download: &str, file: &str, total: u64) -> Self {
        DownloadProgress {
            download: download.to_string(),
            file: file.to_string(),
            done: total,
            total,
            percent: 100.0,
            phase: "done".to_string(),
        }
    }
}

fn emit(app: &AppHandle, p: DownloadProgress) {
    // Progress is informational: failing to show it must not fail the download.
    let _ = app.emit(EVENT, p);
}

/// Report an incremental chunk of a single file being downloaded.
pub fn chunk(app: &AppHandle, download: &str, file: &str, done: u64, total: u64) {
    emit(app, DownloadProgress::chunk(download, file, done, total));
}

/// Mark a file as fully downloaded.
pub fn done(app: &AppHandle, download: &str, file: &str, total: u64) {
    emit(app, DownloadProgress::done(download, file, total));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payloads_carry_the_fields_the_frontend_reads() {
        let p =
            serde_json::to_value(DownloadProgress::chunk("d1", "x.pg.parquet", 40, 100)).unwrap();
        assert_eq!(
            p,
            serde_json::json!({
                "download": "d1", "file": "x.pg.parquet", "done": 40, "total": 100,
                "percent": 40.0, "phase": "downloading"
            })
        );
        // An unknown size stays a number (0/0 would be NaN, sent as null).
        assert_eq!(DownloadProgress::chunk("d1", "x", 5, 0).percent, 0.0);
        let end = DownloadProgress::done("d1", "x", 7);
        assert_eq!(
            (end.done, end.percent, end.phase.as_str()),
            (7, 100.0, "done")
        );
    }
}
