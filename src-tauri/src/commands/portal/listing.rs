//! The browse service's listings: the runs of an accession, the run to open
//! and its QPX views.

use super::{BASE, DATASETS_ROOT};
use crate::commands::portal_http;
use crate::qpx::ViewInfo;
use reqwest::Client;

async fn get_html(client: &Client, url: &str) -> Result<String, String> {
    get_listing(client, url)
        .await?
        .ok_or_else(|| format!("request {url}: HTTP 404 Not Found"))
}

/// A listing page, or `None` when the portal answers 404.
async fn get_listing(client: &Client, url: &str) -> Result<Option<String>, String> {
    let resp = client
        .get(url)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("request {url}: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("request {url}: HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| format!("read {url}: {e}"))?;
    Ok(Some(body))
}

/// Very small HTML anchor extractor: returns `(href, link_text)` pairs.
fn extract_links(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(rel) = rest.find("<a href=\"") {
        let after = &rest[rel + 9..];
        let Some(end_href) = after.find('"') else {
            break;
        };
        let href = &after[..end_href];
        let rest2 = &after[end_href + 1..];
        let Some(gt) = rest2.find('>') else { break };
        let between = &rest2[gt + 1..];
        let Some(close) = between.find("</a>") else {
            break;
        };
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
        let Some(end_href) = after.find('"') else {
            break;
        };
        let href = &after[..end_href];
        if !href.ends_with(".parquet") {
            rest = &after[end_href..];
            continue;
        }
        let rest2 = &after[end_href + 1..];
        let Some(gt) = rest2.find('>') else { break };
        let between = &rest2[gt + 1..];
        let Some(close) = between.find("</a>") else {
            break;
        };
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

fn view_base() -> String {
    format!("{BASE}{DATASETS_ROOT}")
}

/// Resolve the `qpx/` folder URL (or the run folder directly) for a dataset,
/// then list its parquet views as `ViewInfo` with `path` = the public HTTPS
/// URL and `size_bytes` from the directory listing.
///
/// `dataset` may be a bare accession (e.g. `PXD014414` — resolved by scanning
/// the run sub-folders) or a full run ref returned by the registry API
/// (e.g. `PXD014414/9688c6886714`), which is used verbatim.
#[tauri::command]
pub async fn portal_list_views(
    dataset: String,
    organism: Option<String>,
    psm_count: Option<u64>,
) -> Result<Vec<ViewInfo>, String> {
    list_views(
        &portal_http::client()?,
        &dataset,
        organism.as_deref(),
        psm_count,
    )
    .await
}

pub(super) async fn list_views(
    client: &Client,
    dataset: &str,
    organism: Option<&str>,
    psm_count: Option<u64>,
) -> Result<Vec<ViewInfo>, String> {
    let (accession, wanted) = match dataset.split_once('/') {
        Some((acc, run)) => (acc.to_string(), Some(run.to_string())),
        None => (dataset.to_string(), None),
    };
    let ds_url = format!("{}{accession}/", view_base());
    let (run_url, run_html) = run_listing(
        client,
        &ds_url,
        &accession,
        wanted.as_deref(),
        organism,
        psm_count,
    )
    .await?;

    // Prefer the `qpx/` sub-folder, else fall back to the run folder directly.
    let qpx_url = if run_html.contains(">qpx/<") {
        format!("{run_url}qpx/")
    } else {
        run_url
    };
    let q_html = get_html(client, &qpx_url).await?;

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
    if views.is_empty() {
        return Err(format!("no QPX parquet files in {qpx_url}"));
    }
    views.sort_by(|a, b| a.view.cmp(&b.view));
    Ok(views)
}

/// The URL and listing of the run to open: `wanted` (the registry's run)
/// when the portal still has it, else the run picked from `ds_url`.
async fn run_listing(
    client: &Client,
    ds_url: &str,
    accession: &str,
    wanted: Option<&str>,
    organism: Option<&str>,
    psm_count: Option<u64>,
) -> Result<(String, String), String> {
    if let Some(run) = wanted {
        let run_url = format!("{ds_url}{run}/");
        if let Some(html) = get_listing(client, &run_url).await? {
            return Ok((run_url, html));
        }
    }
    // The registry can name a run folder that was since replaced, so pick
    // one of the runs the server holds now.
    let ds_html = get_listing(client, ds_url)
        .await?
        .ok_or_else(|| format!("dataset {accession} not found on the portal"))?;
    let run = pick_run(client, ds_url, &ds_html, organism, psm_count)
        .await
        .map_err(|e| match wanted {
            Some(run) => {
                format!("the registry's run {accession}/{run} is gone from the portal; {e}")
            }
            None => e,
        })?;
    let run_url = format!("{ds_url}{run}/");
    let run_html = get_html(client, &run_url).await?;
    Ok((run_url, run_html))
}

/// Run folders (`<run-hash>`) listed on an accession page.
fn run_subdirs(html: &str) -> Vec<String> {
    let mut runs: Vec<String> = extract_links(html)
        .into_iter()
        .filter_map(|(href, _)| {
            href.trim_end_matches('/')
                .rsplit('/')
                .next()
                .map(str::to_string)
        })
        .filter(|last| last.len() >= 8 && last.chars().all(|c| c.is_ascii_hexdigit()))
        .collect();
    runs.dedup();
    runs
}

#[derive(Debug, serde::Deserialize)]
struct RunProvenance {
    #[serde(default)]
    committed_at: i64,
    #[serde(default)]
    files: Vec<serde_json::Value>,
    #[serde(default)]
    stats: serde_json::Value,
}

struct RunInfo {
    run: String,
    committed_at: i64,
    organism: String,
    prefix: String,
    psms: Option<u64>,
}

fn run_info(run: String, p: RunProvenance) -> RunInfo {
    let prefix = p
        .files
        .iter()
        .filter_map(|f| f.get("path").and_then(|v| v.as_str()))
        .filter_map(crate::qpx::parse_filename)
        .map(|(prefix, _, _)| prefix)
        .next()
        .unwrap_or_default();
    let organism = p
        .stats
        .get("organism")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let psms = p.stats.get("psms").and_then(|v| v.as_u64());
    RunInfo {
        run,
        committed_at: p.committed_at,
        organism,
        prefix,
        psms,
    }
}

fn norm(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// Choose the run of an accession to open. Runs without QPX parquet files are
/// skipped. One accession can hold separate datasets (one per organism in
/// PXD014877, one per enzyme in PXD009737), so the registry's PSM count, then
/// its organism, narrow the runs to one prefix; runs sharing a prefix are
/// versions of it, and the newest wins.
fn choose_run(
    runs: Vec<RunInfo>,
    organism: Option<&str>,
    psm_count: Option<u64>,
) -> Result<String, String> {
    let mut runs: Vec<RunInfo> = runs.into_iter().filter(|r| !r.prefix.is_empty()).collect();
    if runs.is_empty() {
        return Err("it has no run with QPX parquet files".to_string());
    }
    runs.sort_by_key(|r| std::cmp::Reverse(r.committed_at));
    let narrow = |runs: &mut Vec<RunInfo>, keep: &dyn Fn(&RunInfo) -> bool| {
        if runs.iter().any(keep) {
            runs.retain(|r| keep(r));
        }
    };
    if let Some(n) = psm_count.filter(|n| *n > 0) {
        narrow(&mut runs, &|r| r.psms == Some(n));
    }
    if let Some(want) = organism.map(norm).filter(|w| !w.is_empty()) {
        narrow(&mut runs, &|r| norm(&r.organism) == want);
    }
    let prefix = &runs[0].prefix;
    if runs.iter().all(|r| &r.prefix == prefix) {
        return Ok(runs[0].run.clone());
    }
    let mut names: Vec<&str> = runs.iter().map(|r| r.prefix.as_str()).collect();
    names.sort();
    names.dedup();
    Err(format!(
        "it holds separate runs ({}) and none matches this entry",
        names.join(", ")
    ))
}

async fn pick_run(
    client: &Client,
    ds_url: &str,
    ds_html: &str,
    organism: Option<&str>,
    psm_count: Option<u64>,
) -> Result<String, String> {
    let runs = run_subdirs(ds_html);
    if runs.is_empty() {
        return Err("it has no run folders".to_string());
    }
    if runs.len() == 1 {
        return Ok(runs[0].clone());
    }
    let fetches = runs.into_iter().map(|run| {
        let client = client.clone();
        let url = format!("{ds_url}{run}/provenance.json");
        async move {
            let p: RunProvenance = client
                .get(&url)
                .send()
                .await
                .and_then(|r| r.error_for_status())
                .map_err(|e| format!("{url}: {}", e.without_url()))?
                .json()
                .await
                .map_err(|e| format!("{url}: {}", e.without_url()))?;
            Ok::<_, String>(run_info(run, p))
        }
    });
    let infos = futures::future::try_join_all(fetches).await?;
    choose_run(infos, organism, psm_count)
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

    /// Answers every request with `status` and an empty body.
    async fn status_server(status: &'static str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let _ = sock.read(&mut buf).await;
                    let resp = format!(
                        "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                });
            }
        });
        format!("http://{addr}")
    }

    /// Answers GETs of the listed paths with `(status, body)`; anything else
    /// gets a 404.
    async fn route_server(routes: Vec<(&'static str, &'static str, &'static str)>) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let routes = std::sync::Arc::new(routes);
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let routes = routes.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = req.split_whitespace().nth(1).unwrap_or("");
                    let (status, body) = routes
                        .iter()
                        .find(|r| r.0 == path)
                        .map_or(("404 Not Found", ""), |r| (r.1, r.2));
                    let resp = format!(
                        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                });
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn registry_run_is_replaced_only_when_gone() {
        let base = route_server(vec![
            ("/ds/aaaaaaaa1111/", "500 Internal Server Error", ""),
            ("/ds/", "200 OK", r#"<a href="bbbbbbbb2222/">b</a>"#),
            ("/ds/bbbbbbbb2222/", "200 OK", "run b"),
        ])
        .await;
        let ds_url = format!("{base}/ds/");
        let client = Client::new();
        // The registry's run is missing (404): open the run the portal has.
        let (url, html) = run_listing(&client, &ds_url, "X", Some("cccccccc3333"), None, None)
            .await
            .unwrap();
        assert_eq!(
            (url.as_str(), html.as_str()),
            (format!("{ds_url}bbbbbbbb2222/").as_str(), "run b")
        );
        // The registry's run failed for another reason: report it.
        let e = run_listing(&client, &ds_url, "X", Some("aaaaaaaa1111"), None, None)
            .await
            .unwrap_err();
        assert!(e.contains("500"), "{e}");
    }

    #[tokio::test]
    async fn run_choice_reports_provenance_errors() {
        let base = status_server("500 Internal Server Error").await;
        let html = r#"<a href="aaaaaaaa1111/">a</a> <a href="bbbbbbbb2222/">b</a>"#;
        let e = pick_run(&Client::new(), &format!("{base}/ds/"), html, None, None)
            .await
            .unwrap_err();
        assert!(e.contains("provenance.json") && e.contains("500"), "{e}");
    }

    fn info(run: &str, at: i64, organism: &str, prefix: &str, psms: u64) -> RunInfo {
        RunInfo {
            run: run.into(),
            committed_at: at,
            organism: organism.into(),
            prefix: prefix.into(),
            psms: Some(psms),
        }
    }

    #[test]
    fn choose_run_takes_newest_version_of_the_matching_entry() {
        let versions = vec![
            info("old", 1, "homo sapiens", "IPX1", 5),
            info("new", 2, "homo sapiens", "IPX1", 5),
            info("expr", 3, "homo sapiens", "", 0),
        ];
        assert_eq!(choose_run(versions, None, Some(5)).unwrap(), "new");
        let enzymes = || {
            vec![
                info("trypsin", 3, "Homo sapiens", "PXD009737-Trypsin", 573439),
                info("lysc-old", 1, "Homo sapiens", "PXD009737-LysC", 428263),
                info("lysc", 2, "Homo sapiens", "PXD009737-LysC", 428263),
            ]
        };
        assert_eq!(
            choose_run(enzymes(), Some("homo sapiens"), Some(428263)).unwrap(),
            "lysc"
        );
        assert!(choose_run(enzymes(), Some("homo sapiens"), None).is_err());
        let organisms = || {
            vec![
                info(
                    "vp",
                    1,
                    "Veillonella parvula",
                    "PXD014877-Veillonella-parvula",
                    10,
                ),
                info("dr", 1, "Danio rerio", "PXD014877-Danio-rerio", 20),
            ]
        };
        assert_eq!(
            choose_run(organisms(), Some("danio rerio"), Some(99)).unwrap(),
            "dr"
        );
        assert!(choose_run(organisms(), Some("gallus gallus"), None).is_err());
    }
}
