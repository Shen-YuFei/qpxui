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

/// Write base64-encoded bytes to a path chosen by the user in a save dialog
/// (chart PNG / CSV exports from the report views).
#[tauri::command]
pub fn write_file_bytes(path: String, base64: String) -> Result<(), String> {
    let bytes = B64_STANDARD
        .decode(base64.trim())
        .map_err(|e| format!("invalid export payload: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("failed to write {path}: {e}"))
}
