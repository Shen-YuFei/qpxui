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

    let datasets = qpx::discover_dir(parent, "dataset");
    datasets
        .into_iter()
        .find(|d| d.prefix == prefix)
        .ok_or_else(|| format!("no QPX view files found for prefix {prefix}"))
}

/// Scan a folder that is itself one QPX dataset (all `<prefix>.*.parquet`
/// files in the folder). Returns one DatasetInfo per distinct prefix.
#[tauri::command]
pub fn scan_folder(path: String) -> Result<Vec<DatasetInfo>, String> {
    Ok(qpx::discover_dir(&PathBuf::from(&path), "dataset"))
}

/// Scan a collection folder: a directory tree that contains many QPX
/// projects. Every directory holding parquet files is treated as a dataset.
#[tauri::command]
pub fn scan_collection(path: String) -> Result<Vec<DatasetInfo>, String> {
    let root = PathBuf::from(&path);
    let datasets = qpx::collect_all(&root, "collection", 4);
    if datasets.is_empty() {
        return Err("No QPX datasets (prefix.view.parquet files) found in this folder.".to_string());
    }
    Ok(datasets)
}
