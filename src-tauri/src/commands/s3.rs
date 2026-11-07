use crate::commands::progress;
use crate::commands::transfers as xfers;
use crate::qpx::{self, DatasetInfo, ViewInfo};
use aws_config::meta::region::RegionProviderChain;
use aws_config::BehaviorVersion;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client;
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Object {
    pub key: String,
    pub size_bytes: u64,
    pub last_modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Listing {
    pub bucket: String,
    pub prefix: String,
    pub objects: Vec<S3Object>,
    pub datasets: Vec<DatasetInfo>,
}

async fn client() -> Result<Client, String> {
    client_in(None).await
}

/// Build a client, optionally pinned to a region. A custom endpoint
/// (`AWS_ENDPOINT_URL`, e.g. MinIO / Ceph / a local test server) switches to
/// path-style addressing, which those servers expect.
async fn client_in(region: Option<String>) -> Result<Client, String> {
    let mut loader = aws_config::defaults(BehaviorVersion::latest());
    loader = match region {
        Some(r) => loader.region(aws_config::Region::new(r)),
        None => loader.region(RegionProviderChain::default_provider().or_else("us-east-1")),
    };
    let config = loader.load().await;
    let mut b = aws_sdk_s3::config::Builder::from(&config);
    if std::env::var_os("AWS_ENDPOINT_URL").is_some()
        || std::env::var_os("AWS_ENDPOINT_URL_S3").is_some()
    {
        b = b.force_path_style(true);
    }
    Ok(Client::from_conf(b.build()))
}

/// A client in the bucket's own region. Range reads are many small requests,
/// so we resolve the region once (HeadBucket reports it even on a redirect)
/// instead of paying a cross-region redirect on every request.
pub(crate) async fn client_for_bucket(bucket: &str) -> Result<Client, String> {
    use std::collections::HashMap;
    use std::sync::Mutex;
    static REGIONS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

    let cached = REGIONS.lock().unwrap().as_ref().and_then(|m| m.get(bucket).cloned());
    if let Some(r) = cached {
        return client_in(Some(r)).await;
    }
    let base = client().await?;
    let region = match base.head_bucket().bucket(bucket).send().await {
        Ok(out) => out.bucket_region().map(str::to_string),
        Err(e) => e
            .raw_response()
            .and_then(|r| r.headers().get("x-amz-bucket-region"))
            .map(str::to_string),
    };
    match region {
        Some(r) if Some(r.as_str()) != base.config().region().map(|x| x.as_ref()) => {
            REGIONS.lock().unwrap().get_or_insert_with(HashMap::new).insert(bucket.to_string(), r.clone());
            client_in(Some(r)).await
        }
        _ => Ok(base),
    }
}

fn s3_url(bucket: &str, key: &str) -> String {
    format!("s3://{bucket}/{key}")
}

/// List the objects in a bucket/prefix and group the QPX parquet files into
/// datasets (grouped by the `<prefix>` part of their filenames).
#[tauri::command]
pub async fn list_s3(bucket: String, prefix: Option<String>) -> Result<S3Listing, String> {
    let client = client_for_bucket(&bucket).await?;
    let prefix = prefix.unwrap_or_default();

    let mut objects: Vec<S3Object> = Vec::new();
    let mut paginator = client
        .list_objects_v2()
        .bucket(&bucket)
        .prefix(prefix.clone())
        .into_paginator()
        .send();

    while let Some(page) = paginator.next().await {
        let page = page.map_err(|e| format!("S3 list error: {e}"))?;
        for o in page.contents() {
            if let Some(key) = o.key() {
                objects.push(S3Object {
                    key: key.to_string(),
                    size_bytes: o.size().unwrap_or(0) as u64,
                    last_modified: o.last_modified().map(|d| d.to_string()),
                });
            }
        }
    }

    let mut by_prefix: BTreeMap<String, Vec<ViewInfo>> = BTreeMap::new();
    for obj in &objects {
        let base = obj.key.rsplit('/').next().unwrap_or(&obj.key);
        if let Some((p, view, format)) = qpx::parse_filename(base) {
            by_prefix.entry(p).or_default().push(ViewInfo {
                name: base.to_string(),
                view,
                format,
                path: s3_url(&bucket, &obj.key),
                size_bytes: obj.size_bytes,
            });
        }
    }

    let datasets: Vec<DatasetInfo> = by_prefix
        .into_iter()
        .map(|(p, mut views)| {
            views.sort_by(|a, b| a.view.cmp(&b.view));
            DatasetInfo {
                prefix: p,
                path: format!("s3://{bucket}/{prefix}"),
                views,
                source_kind: "s3".to_string(),
            }
        })
        .collect();

    Ok(S3Listing {
        bucket,
        prefix,
        objects,
        datasets,
    })
}

/// The local cache directory for S3 downloads.
fn cache_root() -> Result<std::path::PathBuf, String> {
    let base = dirs::cache_dir()
        .or_else(dirs::data_local_dir)
        .ok_or_else(|| "no cache directory available".to_string())?;
    Ok(base.join("qpxui").join("s3-cache"))
}

/// Generate short-lived presigned GET URLs for the given S3 views so the
/// frontend can query them *lazily* over HTTP(S) (DuckDB-wasm issues byte
/// range requests on demand, pulling only the parts of the parquet it needs),
/// without ever holding AWS credentials in the browser.
///
/// URLs are valid for 12 hours — plenty for an active desktop session. If you
/// browse the same dataset later, the app simply asks for a fresh set.
#[tauri::command]
pub async fn presign_s3_urls(
    bucket: String,
    paths: Vec<String>,
) -> Result<BTreeMap<String, String>, String> {
    let client = client().await?;
    let mut out = BTreeMap::new();
    for p in &paths {
        let key = p
            .trim_start_matches(&format!("s3://{bucket}/"))
            .to_string();
        let presigned = client
            .get_object()
            .bucket(&bucket)
            .key(&key)
            .presigned(PresigningConfig::expires_in(Duration::from_secs(12 * 60 * 60)).map_err(|e| e.to_string())?)
            .await
            .map_err(|e| format!("S3 presign {key}: {e}"))?;
        out.insert(p.clone(), presigned.uri().to_string());
    }
    Ok(out)
}

/// Download the given `s3://bucket/key` parquet views to the local cache so
/// the rest of the app can query them as ordinary local files. Reports live
/// progress over the `download-progress` event for each file.
#[tauri::command]
pub async fn cache_s3_views(
    app: AppHandle,
    cancel_id: String,
    bucket: String,
    paths: Vec<String>,
) -> Result<Vec<ViewInfo>, String> {
    let token = xfers::begin(&cancel_id);
    let client = client_for_bucket(&bucket).await?;
    let root = cache_root()?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let result: Result<Vec<ViewInfo>, String> = (async {
        // Size everything still to fetch first, so a download that cannot
        // fit on the cache disk is refused before any byte is written.
        let mut plan = Vec::new();
        let mut need = 0u64;
        for p in &paths {
            if xfers::is_cancelled(&token) {
                return Err("cancelled".to_string());
            }
            let key = p
                .trim_start_matches(&format!("s3://{bucket}/"))
                .to_string();
            // Use the bucket as a top-level cache dir to avoid key collisions.
            let local = root.join(&bucket).join(key.replace('/', "_"));
            let size = if local.exists() {
                0
            } else {
                client
                    .head_object()
                    .bucket(&bucket)
                    .key(&key)
                    .send()
                    .await
                    .map_err(|e| format!("S3 head {key}: {e}"))?
                    .content_length()
                    .unwrap_or(0)
                    .max(0) as u64
            };
            need += size;
            plan.push((key, local, size));
        }
        xfers::ensure_space(&root, need)?;

        let mut out = Vec::new();
        for (key, local, head) in plan {
            if xfers::is_cancelled(&token) {
                return Err("cancelled".to_string());
            }
            let base = key.rsplit('/').next().unwrap_or(&key).to_string();
            let (_, view, format) = qpx::parse_filename(&base).unwrap_or_else(|| {
                (String::new(), String::new(), "parquet".to_string())
            });
            if let Some(parent) = local.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }

            let size = if local.exists() {
                // Already cached — no transfer needed.
                std::fs::metadata(&local).map(|m| m.len()).unwrap_or(0)
            } else {
                let mut resp = client
                    .get_object()
                    .bucket(&bucket)
                    .key(&key)
                    .send()
                    .await
                    .map_err(|e| format!("S3 get {key}: {e}"))?;

                // Stream to `<file>.part` (constant memory); the partial file
                // is removed if we bail out on cancel or error.
                let mut part = xfers::PartFile::create(&local).await?;
                loop {
                    let next = match tokio::time::timeout(xfers::POLL, resp.body.try_next()).await {
                        Ok(n) => n.map_err(|e| e.to_string())?,
                        Err(_) if xfers::is_cancelled(&token) => return Err("cancelled".to_string()),
                        Err(_) => continue,
                    };
                    if xfers::is_cancelled(&token) {
                        return Err("cancelled".to_string());
                    }
                    let Some(chunk) = next else { break };
                    part.write(&chunk).await?;
                    progress::chunk(&app, &base, part.written, head);
                }
                if head > 0 && part.written != head {
                    return Err(format!("S3 get {key}: got {} of {} bytes", part.written, head));
                }
                let done = part.finish().await?;
                progress::done(&app, &base, done);
                done
            };
            out.push(ViewInfo {
                name: base,
                view,
                format,
                path: local.to_string_lossy().to_string(),
                size_bytes: size,
            });
        }
        Ok(out)
    })
    .await;

    xfers::end(&cancel_id);
    result
}
