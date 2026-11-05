use base64::engine::general_purpose::STANDARD as B64_STANDARD;
use base64::Engine;

/// Read a local file and return its contents as a base64 string so the
/// frontend can hand the bytes to duckdb-wasm. Used for local parquet views
/// and for S3 views that have already been cached to disk.
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    Ok(B64_STANDARD.encode(&bytes))
}
