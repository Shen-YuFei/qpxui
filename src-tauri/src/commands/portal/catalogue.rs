//! The portal's dataset catalogue API: the registry, search and facets.

use crate::commands::portal_http;
use reqwest::Client;

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
    #[serde(
        default,
        rename(deserialize = "collection_title", serialize = "collectionTitle")
    )]
    pub collection_title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub keywords: Option<Vec<String>>,
    #[serde(default)]
    pub tissues: Option<Vec<String>>,
    #[serde(default)]
    pub publication: Option<Publication>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Publication {
    #[serde(default)]
    pub doi: Option<String>,
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
    registry(&portal_http::client()?, page_size).await
}

/// GET a JSON document from the portal's API, trying up to three times.
async fn get_json<T: serde::de::DeserializeOwned>(client: &Client, url: &str) -> Result<T, String> {
    let mut last = "no attempt".to_string();
    for _ in 0..3 {
        match client.get(url).send().await {
            Ok(resp) => match resp.error_for_status() {
                Ok(resp) => match resp.json::<T>().await {
                    Ok(v) => return Ok(v),
                    Err(e) => last = format!("parse: {e}"),
                },
                Err(e) => last = format!("http: {e}"),
            },
            Err(e) => last = format!("request: {e:?}"),
        }
    }
    Err(format!("{url}: {last}"))
}

pub(super) async fn registry(
    client: &Client,
    page_size: Option<usize>,
) -> Result<Vec<PortalDataset>, String> {
    let page_size = page_size.unwrap_or(50).clamp(1, 100);

    let first: DatasetSearchPage = get_json(
        client,
        &format!("https://api.quantms.org/dataset-search/datasets?page_size={page_size}&page=1"),
    )
    .await?;
    let total_pages = first.total_pages.max(1);
    let mut all = first.datasets;
    for p in 2..=total_pages {
        let page: DatasetSearchPage = get_json(
            client,
            &format!(
                "https://api.quantms.org/dataset-search/datasets?page_size={page_size}&page={p}"
            ),
        )
        .await?;
        all.extend(page.datasets);
    }
    // One accession can hold several runs (e.g. PXD014877 has one per
    // organism), so the run ref, not the accession, identifies an entry.
    let key = |d: &PortalDataset| d.dataset_ref.clone().unwrap_or_else(|| d.accession.clone());
    all.sort_by(|a, b| {
        a.accession
            .cmp(&b.accession)
            .then_with(|| key(a).cmp(&key(b)))
    });
    all.dedup_by(|a, b| key(a) == key(b));
    Ok(all)
}

/// One page of search results from the quantms portal dataset catalogue.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortalSearchResult {
    pub datasets: Vec<PortalDataset>,
    pub total: usize,
    pub page: usize,
    pub total_pages: usize,
    pub sort: String,
}

#[derive(Debug, serde::Deserialize)]
struct SearchPageRaw {
    #[serde(default)]
    datasets: Vec<PortalDataset>,
    #[serde(default)]
    total: usize,
    #[serde(default)]
    page: usize,
    #[serde(default)]
    total_pages: usize,
    #[serde(default)]
    sort: String,
}

/// Facet options shown in the discover UI. Organisms and instruments come from
/// `/facets`, collections from `/collections` (name + title).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortalFacets {
    pub organisms: Vec<String>,
    pub instruments: Vec<String>,
    pub collections: Vec<CollectionOption>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionOption {
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
}

/// Server-side search over the quantms portal dataset catalogue. Only the
/// filters the registry API actually supports are forwarded (`q`, collection,
/// organism, instrument, sort); count/lower-bound filters are not available
/// server-side, so the caller combines this with client-side sorting if needed.
#[tauri::command]
pub async fn portal_search(
    query: Option<String>,
    collection: Option<String>,
    organism: Option<String>,
    instrument: Option<String>,
    sort: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Result<PortalSearchResult, String> {
    let client = portal_http::client()?;

    let mut url = reqwest::Url::parse("https://api.quantms.org/dataset-search/datasets")
        .map_err(|e| format!("bad search URL: {e}"))?;
    {
        let mut qp = url.query_pairs_mut();
        let mut add = |param: &str, value: Option<&str>| {
            if let Some(v) = value.filter(|v| !v.trim().is_empty()) {
                qp.append_pair(param, v);
            }
        };
        add("q", query.as_deref());
        add("collection", collection.as_deref());
        add("organism", organism.as_deref());
        add("instrument", instrument.as_deref());
        add("sort", sort.as_deref());
        qp.append_pair("page", &page.unwrap_or(1).max(1).to_string());
        qp.append_pair(
            "page_size",
            &page_size.unwrap_or(50).clamp(1, 100).to_string(),
        );
    }

    let raw = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request: {e:?}"))?
        .error_for_status()
        .map_err(|e| format!("http: {e}"))?
        .json::<SearchPageRaw>()
        .await
        .map_err(|e| format!("parse: {e}"))?;

    Ok(PortalSearchResult {
        datasets: raw.datasets,
        total: raw.total,
        page: raw.page,
        total_pages: raw.total_pages.max(1),
        sort: raw.sort,
    })
}

/// Facet options (organisms, instruments, collections) for the discover UI.
#[tauri::command]
pub async fn portal_facets() -> Result<PortalFacets, String> {
    let client = portal_http::client()?;

    let values = |raw: &serde_json::Value, bucket: &str| -> Vec<String> {
        raw.get(bucket)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|f| f.get("value").and_then(|v| v.as_str()))
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default()
    };

    let fac: serde_json::Value =
        get_json(&client, "https://api.quantms.org/dataset-search/facets").await?;
    let mut organisms = values(&fac, "organism");
    let mut instruments = values(&fac, "instrument");
    organisms.sort();
    instruments.sort();

    #[derive(serde::Deserialize)]
    struct CollectionsRaw {
        #[serde(default)]
        collections: Vec<CollectionOption>,
    }
    let colls: CollectionsRaw = get_json(
        &client,
        "https://api.quantms.org/dataset-search/collections",
    )
    .await?;

    Ok(PortalFacets {
        organisms,
        instruments,
        collections: colls.collections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_results_read_snake_case_and_send_camel_case() {
        let raw: SearchPageRaw = serde_json::from_value(serde_json::json!({
            "datasets": [{ "accession": "PXD1", "psm_count": 5, "dataset_ref": "PXD1/ab" }],
            "total": 1,
            "page": 1,
            "total_pages": 1,
            "sort": "samples"
        }))
        .unwrap();
        let result = PortalSearchResult {
            datasets: raw.datasets,
            total: raw.total,
            page: raw.page,
            total_pages: raw.total_pages,
            sort: raw.sort,
        };
        let out = serde_json::to_value(result).unwrap();
        assert_eq!(out["totalPages"], 1);
        assert_eq!(out["sort"], "samples");
        assert_eq!(out["datasets"][0]["psmCount"], 5);
        assert_eq!(out["datasets"][0]["datasetRef"], "PXD1/ab");
    }
}
