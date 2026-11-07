use crate::qpx::{self, DatasetInfo};
use std::path::PathBuf;

/// Open a single QPX parquet file and assemble the whole dataset (all sibling
/// views sharing the file's prefix) that lives in its folder.
#[tauri::command]
pub fn open_file(path: String) -> Result<DatasetInfo, String> {
    let p = PathBuf::from(&path);
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid path".to_string())?;
    let (prefix, _, _) = qpx::parse_filename(name)
        .ok_or_else(|| "not a QPX file (expected <prefix>.<view>.parquet)".to_string())?;
    let parent = p
        .parent()
        .ok_or_else(|| "file has no parent directory".to_string())?;

    let datasets = qpx::discover_dir(parent)?;
    datasets
        .into_iter()
        .find(|d| d.prefix == prefix)
        .ok_or_else(|| format!("no QPX view files found for prefix {prefix}"))
}

/// Scan a collection folder: a directory tree that contains many QPX
/// projects. Every directory holding parquet files is treated as a dataset.
#[tauri::command]
pub fn scan_collection(path: String) -> Result<Vec<DatasetInfo>, String> {
    let root = PathBuf::from(&path);
    let datasets = qpx::collect_all(&root, 4)?;
    if datasets.is_empty() {
        return Err(
            "No QPX datasets (prefix.view.parquet files) found in this folder.".to_string(),
        );
    }
    Ok(datasets)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn set_mode(dir: &std::path::Path, mode: u32) {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode)).unwrap();
    }

    #[test]
    fn unreadable_folder_reports_why() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("locked");
        std::fs::create_dir(&dir).unwrap();
        let file = dir.join("PXD1.psm.parquet");
        std::fs::write(&file, b"x").unwrap();
        set_mode(&dir, 0o000);
        let scan = scan_collection(dir.to_string_lossy().to_string());
        let open = open_file(file.to_string_lossy().to_string());
        set_mode(&dir, 0o755);
        assert!(scan.unwrap_err().contains("Permission denied"));
        assert!(open.unwrap_err().contains("Permission denied"));
    }

    #[test]
    fn unreadable_subfolder_does_not_stop_a_collection_scan() {
        let tmp = tempfile::tempdir().unwrap();
        let (good, locked) = (tmp.path().join("good"), tmp.path().join("locked"));
        for d in [&good, &locked] {
            std::fs::create_dir(d).unwrap();
            std::fs::write(d.join("PXD1.psm.parquet"), b"x").unwrap();
        }
        set_mode(&locked, 0o000);
        let scan = scan_collection(tmp.path().to_string_lossy().to_string());
        set_mode(&locked, 0o755);
        let found = scan.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, good.to_string_lossy());
        assert_eq!(found[0].views[0].size_bytes, 1);
    }
}
