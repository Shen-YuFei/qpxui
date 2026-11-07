use base64::engine::general_purpose::STANDARD as B64_STANDARD;
use base64::Engine;

/// Write base64-encoded bytes to a path chosen by the user in a save dialog
/// (chart PNG / CSV exports from the report views).
#[tauri::command]
pub fn write_file_bytes(path: String, base64: String) -> Result<(), String> {
    let bytes = B64_STANDARD
        .decode(base64.trim())
        .map_err(|e| format!("invalid export payload: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("failed to write {path}: {e}"))
}
