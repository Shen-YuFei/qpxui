//! QPX dataset discovery: parse `<prefix>.<view>.<format>` names and group
//! the parquet views of a dataset folder.

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

/// A single QPX view file (e.g. `PXD021013.feature.parquet`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewInfo {
    pub name: String,
    pub view: String,
    pub format: String,
    /// Local absolute path, or an `s3://bucket/key` locator for remote views.
    pub path: String,
    pub size_bytes: u64,
}

/// All views belonging to one dataset prefix.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetInfo {
    pub prefix: String,
    /// Directory (or s3 locator) holding the dataset.
    pub path: String,
    pub views: Vec<ViewInfo>,
    /// single-file | dataset | collection | s3
    pub source_kind: String,
}

/// Split a QPX filename into `(prefix, view, format)`.
///
/// `PXD021013.feature.parquet` -> `("PXD021013", "feature", "parquet")`.
pub fn parse_filename(filename: &str) -> Option<(String, String, String)> {
    let mut it = filename.rsplitn(2, '.');
    let format = it.next()?.to_ascii_lowercase();
    let rest = it.next()?;
    let mut it2 = rest.rsplitn(2, '.');
    let view = it2.next()?;
    let prefix = it2.next()?;
    if prefix.is_empty() || view.is_empty() {
        return None;
    }
    Some((prefix.to_string(), view.to_string(), format))
}

fn into_datasets(
    by_prefix: BTreeMap<String, Vec<ViewInfo>>,
    dir: String,
    source_kind: &str,
) -> Vec<DatasetInfo> {
    by_prefix
        .into_iter()
        .map(|(prefix, mut views)| {
            views.sort_by(|a, b| a.view.cmp(&b.view));
            DatasetInfo {
                prefix,
                path: dir.clone(),
                views,
                source_kind: source_kind.to_string(),
            }
        })
        .collect()
}

/// Discover all datasets (grouped by prefix) directly inside `dir`.
pub fn discover_dir(dir: &Path, source_kind: &str) -> Vec<DatasetInfo> {
    let mut by_prefix: BTreeMap<String, Vec<ViewInfo>> = BTreeMap::new();
    if let Ok(readdir) = std::fs::read_dir(dir) {
        for entry in readdir.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    if let Some((prefix, view, format)) = parse_filename(name) {
                        let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                        by_prefix.entry(prefix).or_default().push(ViewInfo {
                            name: name.to_string(),
                            view,
                            format,
                            path: p.to_string_lossy().to_string(),
                            size_bytes: size,
                        });
                    }
                }
            }
        }
    }
    into_datasets(by_prefix, dir.to_string_lossy().to_string(), source_kind)
}

/// Recursively walk a folder (up to `max_depth`) collecting datasets from
/// every directory that directly contains QPX parquet files. This handles
/// flat collections (many prefixes in one dir) and nested collections
/// (one dataset per subdirectory).
pub fn collect_all(root: &Path, source_kind: &str, max_depth: u32) -> Vec<DatasetInfo> {
    let mut out = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    walk(root, source_kind, 0, max_depth, &mut out, &mut seen);
    out
}

fn walk(
    dir: &Path,
    source_kind: &str,
    depth: u32,
    max_depth: u32,
    out: &mut Vec<DatasetInfo>,
    seen: &mut std::collections::HashSet<String>,
) {
    if depth > max_depth {
        return;
    }
    for ds in discover_dir(dir, source_kind) {
        // Avoid pushing the same dataset twice if a dir and a descendant
        // both contain its files.
        let key = format!("{}|{}", ds.path, ds.prefix);
        if seen.insert(key) {
            out.push(ds);
        }
    }
    if let Ok(readdir) = std::fs::read_dir(dir) {
        for entry in readdir.flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk(&p, source_kind, depth + 1, max_depth, out, seen);
            }
        }
    }
}
