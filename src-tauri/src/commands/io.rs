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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_decoded_bytes_and_rejects_a_bad_payload() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("chart.png").to_string_lossy().to_string();
        let payload = format!("{}\n", B64_STANDARD.encode(b"\x89PNG"));
        write_file_bytes(path.clone(), payload).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"\x89PNG");
        let e = write_file_bytes(path, "not base64!".into()).unwrap_err();
        assert!(e.starts_with("invalid export payload"), "{e}");
    }
}
