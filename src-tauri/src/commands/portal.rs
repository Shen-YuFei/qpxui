//! Public "quantms portal" example source.
//!
//! The quantms portal (https://portal.quantms.org) publishes reanalysed QPX
//! datasets as public parquet files, browsable through a small HTTP service at
//! `https://browse.quantms.org`. The layout is:
//!
//! ```text
//! /quantms/datasets/<PXD-code>/<run-hash>/qpx/<PXD-code>.<view>.parquet
//! ```
//!
//! These files are freely downloadable over HTTPS (no AWS credentials needed),
//! so this module provides the app with a ready-made example source to open.

use crate::commands::progress;
use crate::commands::transfers as xfers;
use crate::qpx::ViewInfo;
use reqwest::Client;
use std::path::PathBuf;
use tauri::AppHandle;

const BASE: &str = "https://browse.quantms.org";
const DATASETS_ROOT: &str = "/quantms/datasets/";

fn cache_root() -> Result<PathBuf, String> {
    let base = dirs::cache_dir()
        .or_else(dirs::data_local_dir)
        .ok_or_else(|| "no cache directory available".to_string())?;
    Ok(base.join("qpxui").join("portal"))
}

async fn get_html(url: &str) -> Result<String, String> {
    let client = Client::builder().build().map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("request {url}: {e}"))?;
    let body = resp
        .text()
        .await
        .map_err(|e| format!("read {url}: {e}"))?;
    Ok(body)
}

/// Very small HTML anchor extractor: returns `(href, link_text)` pairs.
fn extract_links(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(rel) = rest.find("<a href=\"") {
        let after = &rest[rel + 9..];
        let Some(end_href) = after.find('"') else { break };
        let href = &after[..end_href];
        let rest2 = &after[end_href + 1..];
        let Some(gt) = rest2.find('>') else { break };
        let between = &rest2[gt + 1..];
        let Some(close) = between.find("</a>") else { break };
        let text = between[..close].trim();
        out.push((href.to_string(), text.to_string()));
        rest = &between[close + 4..];
    }
    out
}

/// Parse a human-friendly size string like `5,794,378 B`, `4.5 MB`, `1.2 GB`.
fn parse_size(raw: &str) -> u64 {
    // Strip any HTML tags (e.g. `<small>` around the number) and `&nbsp;`.
    let mut clean = String::new();
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => clean.push(ch),
            _ => {}
        }
    }
    let clean = clean
        .replace("&nbsp;", " ")
        .replace('\u{a0}', " ")
        .replace(',', "")
        .trim()
        .to_string();
    let lower = clean.to_lowercase();
    let (num_part, mult) = if lower.ends_with("gb") {
        (clean[..clean.len() - 2].trim(), 1024u64.pow(3))
    } else if lower.ends_with("mb") {
        (clean[..clean.len() - 2].trim(), 1024u64.pow(2))
    } else if lower.ends_with("kb") {
        (clean[..clean.len() - 2].trim(), 1024u64)
    } else if lower.ends_with('b') {
        (clean[..clean.len() - 1].trim(), 1u64)
    } else {
        (clean.trim(), 1u64)
    };
    let n: f64 = num_part
        .split_whitespace()
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);
    (n * mult as f64) as u64
}

/// `(<link text>, <size bytes>)` for the parquet links on a listing page.
fn parquet_entries(html: &str) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(rel) = rest.find("<a href=\"") {
        let after = &rest[rel + 9..];
        let Some(end_href) = after.find('"') else { break };
        let href = &after[..end_href];
        if !href.ends_with(".parquet") {
            rest = &after[end_href..];
            continue;
        }
        let rest2 = &after[end_href + 1..];
        let Some(gt) = rest2.find('>') else { break };
        let between = &rest2[gt + 1..];
        let Some(close) = between.find("</a>") else { break };
        let name = between[..close].trim();
        // After `</a>` comes whitespace, `&nbsp;`, then the size, then `<br>`.
        let after_close = &between[close + 4..];
        let size_raw = after_close.split("<br").next().unwrap_or("");
        let size = parse_size(size_raw);
        out.push((name.to_string(), size));
        rest = &between[close + 4..];
    }
    out
}

fn first_subdir(html: &str) -> Option<String> {
    extract_links(html)
        .into_iter()
        .map(|(href, _)| href.trim_end_matches('/').to_string())
        .filter(|h| h.len() >= 4) // skip "../" etc.
        .map(|h| {
            // Return only the last path component (the run-hash), not the full
            // href path — the caller already prepends the dataset base URL.
            h.rsplit('/').next().unwrap_or("").to_string()
        })
        .find(|last| {
            last.chars().all(|c| c.is_ascii_hexdigit()) && last.len() >= 8
        })
}

/// List all dataset codes at the portal root (PXD…, IPX…, MSV…, PDC…, PMID…).
#[tauri::command]
pub async fn portal_datasets(limit: Option<usize>) -> Result<Vec<String>, String> {
    let url = format!("{BASE}{DATASETS_ROOT}");
    let html = get_html(&url).await?;
    let mut codes: Vec<String> = extract_links(&html)
        .into_iter()
        .map(|(href, _)| href.trim_end_matches('/').to_string())
        .filter_map(|h| h.rsplit('/').next().map(|s| s.to_string()))
        .filter(|name| {
            !name.is_empty()
                && name != ".."
                && name
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_uppercase())
                    .unwrap_or(false)
        })
        .collect();
    codes.sort();
    codes.dedup();
    if let Some(n) = limit {
        codes.truncate(n);
    }
    Ok(codes)
}

fn view_base() -> String {
    format!("{BASE}{DATASETS_ROOT}")
}

/// Registry metadata for a reanalysed dataset on the quantms portal.
///
/// The source API uses snake_case keys; the app's frontend uses camelCase, so
/// deserialization reads the snake_case fields and serialization emits camelCase.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PortalDataset {
    pub accession: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub organism: Option<String>,
    #[serde(default)]
    pub instrument: Option<String>,
    #[serde(default)]
    pub samples: Option<u64>,
    #[serde(default)]
    pub proteins: Option<u64>,
    #[serde(default)]
    pub peptides: Option<u64>,
    #[serde(default, rename(deserialize = "psm_count", serialize = "psmCount"))]
    pub psm_count: Option<u64>,
    #[serde(default, rename(deserialize = "total_size", serialize = "totalSize"))]
    pub total_size: Option<u64>,
    /// `accession/run-hash`, used to resolve the view URLs directly.
    #[serde(default, rename(deserialize = "dataset_ref", serialize = "datasetRef"))]
    pub dataset_ref: Option<String>,
    #[serde(default, rename(deserialize = "px_url", serialize = "pxUrl"))]
    pub px_url: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct DatasetSearchPage {
    #[serde(default)]
    total_pages: usize,
    #[serde(default)]
    datasets: Vec<PortalDataset>,
}

/// List the searchable registry of reanalysed datasets from the quantms portal
/// (fetched from `api.quantms.org/dataset-search/datasets`, paging through all
/// results). This gives a rich, searchable catalogue rather than a bare list.
#[tauri::command]
pub async fn portal_registry(page_size: Option<usize>) -> Result<Vec<PortalDataset>, String> {
    let page_size = page_size.unwrap_or(50).clamp(1, 100);
    let client = Client::builder().build().map_err(|e| e.to_string())?;

    async fn get_page(
        client: &Client,
        url: &str,
    ) -> Result<DatasetSearchPage, String> {
        let mut last = "no attempt".to_string();
        for _ in 0..3 {
            match client.get(url).send().await {
                Ok(resp) => match resp.error_for_status() {
                    Ok(resp) => match resp.json::<DatasetSearchPage>().await {
                        Ok(page) => return Ok(page),
                        Err(e) => last = format!("parse: {e}"),
                    },
                    Err(e) => last = format!("http: {e}"),
                },
                Err(e) => last = format!("request: {e}"),
            }
        }
        Err(format!("{url}: {last}"))
    }

    let first = get_page(
        &client,
        &format!("https://api.quantms.org/dataset-search/datasets?page_size={page_size}&page=1"),
    )
    .await?;
    let total_pages = first.total_pages.max(1);
    let mut all = first.datasets;
    for p in 2..=total_pages {
        let page = get_page(
            &client,
            &format!("https://api.quantms.org/dataset-search/datasets?page_size={page_size}&page={p}"),
        )
        .await?;
        all.extend(page.datasets);
    }
    all.sort_by(|a, b| a.accession.cmp(&b.accession));
    all.dedup_by(|a, b| a.accession == b.accession);
    Ok(all)
}

/// Resolve the `qpx/` folder URL (or the run folder directly) for a dataset,
/// then list its parquet views as `ViewInfo` with `path` = the public HTTPS
/// URL and `size_bytes` from the directory listing.
///
/// `dataset` may be a bare accession (e.g. `PXD014414` — resolved by scanning
/// the run sub-folders) or a full run ref returned by the registry API
/// (e.g. `PXD014414/9688c6886714`), which is used verbatim.
#[tauri::command]
pub async fn portal_list_views(dataset: String) -> Result<Vec<ViewInfo>, String> {
    let (run_url, run_html) = if dataset.contains('/') {
        // Already a full "accession/run-hash" ref.
        let run_url = format!("{}{dataset}/", view_base());
        let run_html = get_html(&run_url).await?;
        (run_url, run_html)
    } else {
        let ds_url = format!("{}{dataset}/", view_base());
        let ds_html = get_html(&ds_url).await?;
        let run = first_subdir(&ds_html).ok_or_else(|| {
            format!("no run sub-folder found for dataset {dataset}")
        })?;
        let run_url = format!("{ds_url}{run}/");
        let run_html = get_html(&run_url).await?;
        (run_url, run_html)
    };

    // Prefer the `qpx/` sub-folder, else fall back to the run folder directly.
    let qpx_url = if run_html.contains(">qpx/</a>") || run_html.contains(">qpx/<") {
        format!("{run_url}qpx/")
    } else {
        run_url
    };
    let q_html = get_html(&qpx_url).await?;

    let mut views = Vec::new();
    for (name, size) in parquet_entries(&q_html) {
        if let Some((_p, v, fmt)) = crate::qpx::parse_filename(&name) {
            views.push(ViewInfo {
                name: name.clone(),
                view: v,
                format: fmt,
                path: format!("{qpx_url}{name}"),
                size_bytes: size,
            });
        }
    }
    views.sort_by(|a, b| a.view.cmp(&b.view));
    Ok(views)
}

/// Download the given public parquet URLs into the local cache and return
/// their `ViewInfo` with `path` pointing at the local file. Reports live
/// progress over the `download-progress` event for each file.
#[tauri::command]
pub async fn portal_cache_views(
    app: AppHandle,
    cancel_id: String,
    urls: Vec<String>,
) -> Result<Vec<ViewInfo>, String> {
    portal_cache_views_impl(Some(&app), cancel_id, urls).await
}

/// Testable core of [`portal_cache_views`]; `app` may be `None` in tests.
async fn portal_cache_views_impl(
    app: Option<&AppHandle>,
    cancel_id: String,
    urls: Vec<String>,
) -> Result<Vec<ViewInfo>, String> {
    let token = xfers::begin(&cancel_id);
    let client = Client::builder().build().map_err(|e| e.to_string())?;
    let root = cache_root()?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let result: Result<Vec<ViewInfo>, String> = (async {
        let mut out = Vec::new();
        for url in urls {
            if xfers::is_cancelled(&token) {
                return Err("cancelled".to_string());
            }
            let name = url
                .rsplit('/')
                .next()
                .ok_or_else(|| format!("bad url {url}"))?
                .to_string();
            let (_, view, format) = crate::qpx::parse_filename(&name).unwrap_or_else(|| {
                (String::new(), String::new(), "parquet".to_string())
            });
            let local = root.join(&name);
            let size = if local.exists() {
                std::fs::metadata(&local).map(|m| m.len()).unwrap_or(0)
            } else {
                let resp = client
                    .get(&url)
                    .send()
                    .await
                    .map_err(|e| format!("download {name}: {e}"))?;
                if !resp.status().is_success() {
                    return Err(format!("download {name}: HTTP {}", resp.status()));
                }
                let total = resp.content_length().unwrap_or(0);

                // Stream chunk-by-chunk so we can report progress and cancel.
                let mut buf: Vec<u8> = Vec::new();
                let mut stream = resp.bytes_stream();
                let mut done = 0u64;
                use futures::StreamExt;
                while let Some(chunk) = stream.next().await {
                    if xfers::is_cancelled(&token) {
                        return Err("cancelled".to_string());
                    }
                    let chunk = chunk.map_err(|e| format!("read {name}: {e}"))?;
                    buf.extend_from_slice(&chunk);
                    done += chunk.len() as u64;
                    if let Some(app) = app {
                        progress::chunk(app, &name, done, total);
                    }
                }
                if xfers::is_cancelled(&token) {
                    return Err("cancelled".to_string());
                }
                std::fs::write(&local, &buf).map_err(|e| e.to_string())?;
                if let Some(app) = app {
                    progress::done(app, &name, done);
                }
                done
            };
            out.push(ViewInfo {
                name,
                view,
                format,
                path: local.to_string_lossy().to_string(),
                size_bytes: size,
            });
        }
        Ok(out)
    })
    .await;

    // Clean up the token whether we succeeded, failed, or were cancelled.
    xfers::end(&cancel_id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_parser_strips_tags_and_nbsp() {
        assert_eq!(parse_size(" &nbsp;<small>5,794,378 B</small>"), 5_794_378);
        assert_eq!(parse_size("<small>4.5 MB</small>"), 4_718_592);
        assert_eq!(parse_size("<small>1.2 GB</small>"), 1288490188);
        assert_eq!(parse_size(" 1,032 B "), 1032);
    }

    #[tokio::test]
    async fn portal_lists_and_downloads_pxd014414() {
        let ds = "PXD014414".to_string();
        let views = portal_list_views(ds.clone()).await.expect("list views");
        assert!(!views.is_empty(), "expected views for {ds}");
        assert!(views.iter().any(|v| v.size_bytes > 0), "sizes should be > 0");

        let url = views
            .iter()
            .find(|v| v.view == "dataset")
            .map(|v| v.path.clone())
            .expect("dataset view present");
        let cached = portal_cache_views_impl(None, "test-cancel".to_string(), vec![url])
            .await
            .expect("cache");
        assert_eq!(cached.len(), 1);
        assert!(cached[0].size_bytes > 0);
        assert!(std::path::Path::new(&cached[0].path).exists());
    }

    #[tokio::test]
    async fn registry_lists_and_ref_resolves() {
        let rows = portal_registry(Some(100)).await.expect("registry");
        assert!(rows.len() >= 80, "expected ~83 unique datasets, got {}", rows.len());
        let with_ref = rows
            .iter()
            .find(|r| r.dataset_ref.is_some())
            .expect("some dataset has a run ref");
        let views = portal_list_views(with_ref.dataset_ref.clone().unwrap())
            .await
            .expect("list views from ref");
        assert!(!views.is_empty());
        assert!(views.iter().any(|v| v.size_bytes > 0));
    }
}
