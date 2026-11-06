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
///
/// π-MSNet collections ship their annotated PSMs (with spectra) as
/// `<prefix>-MSNet.parquet` or `<prefix>-MSNet.psm.parquet`; both map to the
/// `psm` view of `<prefix>` so they group with the sibling metadata views.
pub fn parse_filename(filename: &str) -> Option<(String, String, String)> {
    let mut it = filename.rsplitn(2, '.');
    let format = it.next()?.to_ascii_lowercase();
    let rest = it.next()?;
    if let Some(prefix) = strip_msnet(rest) {
        return Some((prefix.to_string(), "psm".to_string(), format));
    }
    if let Some((p, v)) = rest.rsplit_once('.') {
        if v == "psm" {
            if let Some(prefix) = strip_msnet(p) {
                return Some((prefix.to_string(), "psm".to_string(), format));
            }
        }
    }
    let mut it2 = rest.rsplitn(2, '.');
    let view = it2.next()?;
    let prefix = it2.next()?;
    if prefix.is_empty() || view.is_empty() {
        return None;
    }
    Some((prefix.to_string(), view.to_string(), format))
}

fn strip_msnet(s: &str) -> Option<&str> {
    let n = s.len().checked_sub("-MSNet".len())?;
    if n > 0 && s.is_char_boundary(n) && s[n..].eq_ignore_ascii_case("-MSNet") {
        Some(&s[..n])
    } else {
        None
    }
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

#[cfg(test)]
mod tests {
    use super::parse_filename;

    fn p(s: &str) -> Option<(String, String, String)> {
        parse_filename(s)
    }

    #[test]
    fn standard_and_msnet_names() {
        let t = |a: &str, b: &str, c: &str| Some((a.to_string(), b.to_string(), c.to_string()));
        assert_eq!(p("PXD021013.feature.parquet"), t("PXD021013", "feature", "parquet"));
        assert_eq!(p("PXD021013-MSNet.parquet"), t("PXD021013", "psm", "parquet"));
        assert_eq!(p("PDC000219-MSNet.psm.parquet"), t("PDC000219", "psm", "parquet"));
        assert_eq!(p("PXD019483-hCOV-MSNet.parquet"), t("PXD019483-hCOV", "psm", "parquet"));
        assert_eq!(p("plain.parquet"), None);
    }
}
