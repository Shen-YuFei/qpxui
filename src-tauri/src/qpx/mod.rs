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
}

#[derive(Debug, Serialize)]
pub struct SkippedFolder {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Default, Serialize)]
pub struct CollectionScan {
    pub datasets: Vec<DatasetInfo>,
    pub skipped: Vec<SkippedFolder>,
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
    let (prefix, view) = rest.rsplit_once('.')?;
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

fn into_datasets(by_prefix: BTreeMap<String, Vec<ViewInfo>>, dir: String) -> Vec<DatasetInfo> {
    by_prefix
        .into_iter()
        .map(|(prefix, mut views)| {
            views.sort_by(|a, b| a.view.cmp(&b.view));
            DatasetInfo {
                prefix,
                path: dir.clone(),
                views,
            }
        })
        .collect()
}

/// Discover all datasets (grouped by prefix) directly inside `dir`.
pub fn discover_dir(dir: &Path) -> Result<Vec<DatasetInfo>, String> {
    let fail = |e: std::io::Error| format!("{}: {e}", dir.display());
    let mut by_prefix: BTreeMap<String, Vec<ViewInfo>> = BTreeMap::new();
    for entry in std::fs::read_dir(dir).map_err(fail)? {
        let path = entry.map_err(fail)?.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some((prefix, view, format)) = parse_filename(name) else {
            continue;
        };
        let meta = match std::fs::metadata(&path) {
            Ok(meta) => meta,
            // A dangling symlink is not a view.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        if !meta.is_file() {
            continue;
        }
        by_prefix.entry(prefix).or_default().push(ViewInfo {
            name: name.to_string(),
            view,
            format,
            path: path.to_string_lossy().to_string(),
            size_bytes: meta.len(),
        });
    }
    Ok(into_datasets(by_prefix, dir.to_string_lossy().to_string()))
}

/// Recursively walk a folder (up to `max_depth` levels below it) collecting
/// datasets from every directory that directly contains QPX parquet files.
/// This handles flat collections (many prefixes in one dir) and nested
/// collections (one dataset per subdirectory). An error reading `root` is
/// returned; an unreadable sub-folder (a protected system folder in a large
/// tree, say) is skipped so that the rest of the tree still opens.
pub fn collect_all(root: &Path, max_depth: u32) -> Result<CollectionScan, String> {
    let mut out = CollectionScan::default();
    walk(root, max_depth, &mut out)?;
    Ok(out)
}

fn walk(dir: &Path, depth_left: u32, out: &mut CollectionScan) -> Result<(), String> {
    out.datasets.extend(discover_dir(dir)?);
    if depth_left == 0 {
        return Ok(());
    }
    let fail = |e: std::io::Error| format!("{}: {e}", dir.display());
    for entry in std::fs::read_dir(dir).map_err(fail)? {
        let path = entry.map_err(fail)?.path();
        if path.is_dir() {
            if let Err(reason) = walk(&path, depth_left - 1, out) {
                out.skipped.push(SkippedFolder {
                    path: path.to_string_lossy().to_string(),
                    reason,
                });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{collect_all, discover_dir, parse_filename};

    fn p(s: &str) -> Option<(String, String, String)> {
        parse_filename(s)
    }

    #[test]
    fn standard_and_msnet_names() {
        let t = |a: &str, b: &str, c: &str| Some((a.to_string(), b.to_string(), c.to_string()));
        assert_eq!(
            p("PXD021013.feature.parquet"),
            t("PXD021013", "feature", "parquet")
        );
        assert_eq!(
            p("PXD021013-MSNet.parquet"),
            t("PXD021013", "psm", "parquet")
        );
        assert_eq!(
            p("PDC000219-MSNet.psm.parquet"),
            t("PDC000219", "psm", "parquet")
        );
        assert_eq!(
            p("PXD019483-hCOV-MSNet.parquet"),
            t("PXD019483-hCOV", "psm", "parquet")
        );
        assert_eq!(p("plain.parquet"), None);
    }

    #[test]
    fn a_folder_groups_its_view_files_by_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        for (name, len) in [
            ("B.psm.parquet", 3),
            ("A.pg.parquet", 1),
            ("A.feature.parquet", 2),
            ("notes.txt", 1),
            ("plain.parquet", 1),
        ] {
            std::fs::write(d.join(name), vec![0u8; len]).unwrap();
        }
        std::fs::create_dir(d.join("C.run.parquet")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(d.join("gone"), d.join("D.pg.parquet")).unwrap();
        let found: Vec<_> = discover_dir(d)
            .unwrap()
            .into_iter()
            .map(|ds| {
                let views: Vec<_> = ds
                    .views
                    .into_iter()
                    .map(|v| (v.view, v.size_bytes))
                    .collect();
                (ds.prefix, views)
            })
            .collect();
        let view = |v: &str, n: u64| (v.to_string(), n);
        assert_eq!(
            found,
            [
                ("A".to_string(), vec![view("feature", 2), view("pg", 1)]),
                ("B".to_string(), vec![view("psm", 3)]),
            ]
        );
    }

    #[test]
    fn a_collection_scan_stops_at_its_depth() {
        let tmp = tempfile::tempdir().unwrap();
        let deep = tmp.path().join("a").join("b");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(tmp.path().join("a").join("X.pg.parquet"), b"x").unwrap();
        std::fs::write(deep.join("Y.pg.parquet"), b"y").unwrap();
        let prefixes = |depth| -> Vec<String> {
            let found = collect_all(tmp.path(), depth).unwrap();
            found.datasets.into_iter().map(|d| d.prefix).collect()
        };
        assert_eq!(prefixes(1), ["X"]);
        assert_eq!(prefixes(2), ["X", "Y"]);
    }
}
