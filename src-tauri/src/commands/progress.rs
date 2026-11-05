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
    /// Parquet file name (key the frontend uses to index the progress map).
    pub file: String,
    /// Bytes transferred so far.
    pub done: u64,
    /// Total bytes, or 0 when unknown (indeterminate).
    pub total: u64,
    /// 0..100 fraction done.
    pub percent: f64,
    /// `downloading` | `done` | `error`.
    pub phase: String,
}

fn emit(app: &AppHandle, p: &DownloadProgress) {
    // No listener (or a mock app) is fine — emit is a no-op broadcast.
    let _ = app.emit(EVENT, p.clone());
}

/// Report an incremental chunk of a single file being downloaded.
pub fn chunk(app: &AppHandle, file: &str, done: u64, total: u64) {
    let percent = if total > 0 {
        (done as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    emit(
        app,
        &DownloadProgress {
            file: file.to_string(),
            done,
            total,
            percent,
            phase: "downloading".to_string(),
        },
    );
}

/// Mark a file as fully downloaded.
pub fn done(app: &AppHandle, file: &str, total: u64) {
    emit(
        app,
        &DownloadProgress {
            file: file.to_string(),
            done: total,
            total,
            percent: 100.0,
            phase: "done".to_string(),
        },
    );
}
