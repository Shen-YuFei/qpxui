use base64::engine::general_purpose::STANDARD as B64_STANDARD;
use base64::Engine;
use serde::Deserialize;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
pub struct ExportFilter {
    name: String,
    extensions: Vec<String>,
}

/// Choose the destination natively, then write the export. The frontend never
/// supplies the destination path; cancelling the dialog leaves files untouched.
#[tauri::command]
pub async fn save_export(
    window: tauri::Window,
    default_name: String,
    filters: Vec<ExportFilter>,
    base64: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(default_name);
        for filter in filters {
            let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(filter.name, &extensions);
        }
        let Some(selected) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        write_export(&path, &base64)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| format!("export task failed: {e}"))?
}

fn write_export(path: &Path, base64: &str) -> Result<(), String> {
    let bytes = B64_STANDARD
        .decode(base64.trim())
        .map_err(|e| format!("invalid export payload: {e}"))?;
    std::fs::write(path, bytes).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_binary_and_utf8_exports() {
        let tmp = tempfile::tempdir().unwrap();
        for bytes in [
            b"\x89PNG\r\n\x1a\n".as_slice(),
            "sample,value\n测试,42\n".as_bytes(),
        ] {
            let path = tmp.path().join("export");
            let payload = format!("{}\n", B64_STANDARD.encode(bytes));
            write_export(&path, &payload).unwrap();
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }

    #[test]
    fn bad_payload_does_not_create_or_overwrite_a_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("export.csv");
        let e = write_export(&path, "not base64!").unwrap_err();
        assert!(e.starts_with("invalid export payload"), "{e}");
        assert!(!path.exists());
        std::fs::write(&path, b"original").unwrap();
        assert!(write_export(&path, "not base64!").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
    }

    #[test]
    fn reports_write_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let e = write_export(tmp.path(), "YQ==").unwrap_err();
        assert!(e.starts_with("failed to write "), "{e}");
    }
}
