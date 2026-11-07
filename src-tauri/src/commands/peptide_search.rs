//! Cross-dataset peptide, protein and gene search against the quantms portal
//! (`https://api.quantms.org/peptide-search`).
//!
//! The quantms portal exposes a search over every QPX dataset it publishes, so
//! a user can ask "which datasets contain this peptide / protein / gene?" and
//! then drill into the matching datasets' QPX views. Results carry per-dataset
//! hit counts plus a few example peptidoforms (with PTM notation), enough to
//! shortlist datasets before downloading anything.

use crate::commands::portal_http;

const BASE: &str = "https://api.quantms.org/peptide-search";

/// One dataset (run) that contains the searched peptide/protein/gene.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct PsHit {
    #[serde(rename(deserialize = "dataset_accession", serialize = "datasetAccession"))]
    pub dataset_accession: String,
    #[serde(rename(deserialize = "dataset_ref", serialize = "datasetRef"))]
    pub dataset_ref: String,
    #[serde(default)]
    pub collection: Option<String>,
    #[serde(default)]
    pub organism: Option<String>,
    #[serde(
        default,
        rename(deserialize = "organism_part", serialize = "organismPart")
    )]
    pub organism_part: Option<String>,
    #[serde(default)]
    pub instrument: Option<String>,
    #[serde(
        default,
        rename(deserialize = "n_peptidoforms", serialize = "nPeptidoforms")
    )]
    pub n_peptidoforms: u64,
    #[serde(default, rename(deserialize = "n_peptides", serialize = "nPeptides"))]
    pub n_peptides: u64,
    #[serde(default, rename(deserialize = "total_obs", serialize = "totalObs"))]
    pub total_obs: u64,
    #[serde(
        default,
        rename(deserialize = "sample_peptidoforms", serialize = "samplePeptidoforms")
    )]
    pub sample_peptidoforms: Vec<String>,
}

/// Result of a peptide/protein/gene search: the datasets that matched.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsSearchResult {
    #[serde(rename(serialize = "totalDatasets"))]
    pub total_datasets: usize,
    pub datasets: Vec<PsHit>,
    #[serde(default)]
    pub unmapped: bool,
}

/// An available post-translational modification on the portal (for the
/// peptide-search filter).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsModification {
    pub name: String,
    #[serde(default, rename(deserialize = "n_datasets", serialize = "nDatasets"))]
    pub n_datasets: usize,
}

/// A pure-uppercase amino-acid run (>= 5 letters) is read as a peptide sequence;
/// anything else is treated as a protein or gene identifier/name.
fn looks_like_peptide(s: &str) -> bool {
    let t = s.trim();
    t.len() >= 5
        && t.chars()
            .all(|c| c.is_ascii_alphabetic() && c.is_uppercase())
}

fn non_empty(v: Option<&str>) -> Option<&str> {
    v.filter(|v| !v.trim().is_empty())
}

/// Search the quantms portal for a peptide sequence, protein identifier/name,
/// or gene symbol across all published QPX datasets.
///
/// `dtype` is `"auto"` (default), `"peptide"`, `"protein"` or `"gene"`.
/// `match_mode` applies to peptide search: `"exact"` (default) or `"contains"`.
#[tauri::command]
pub async fn ps_search(
    query: String,
    dtype: Option<String>,
    match_mode: Option<String>,
    organism: Option<String>,
    modification: Option<String>,
    limit: Option<usize>,
) -> Result<PsSearchResult, String> {
    let kind = dtype.unwrap_or_else(|| "auto".to_string()).to_lowercase();
    let path = match kind.as_str() {
        "peptide" => "search/peptide",
        "gene" => "search/gene",
        "protein" => "search/protein",
        _ => {
            if looks_like_peptide(&query) {
                "search/peptide"
            } else {
                "search/protein"
            }
        }
    };

    let mut url =
        reqwest::Url::parse(&format!("{BASE}/{path}")).map_err(|e| format!("bad URL: {e}"))?;
    {
        let mut qp = url.query_pairs_mut();
        match kind.as_str() {
            "peptide" | "auto" if path == "search/peptide" => {
                qp.append_pair("sequence", query.trim());
                if let Some(m) = non_empty(match_mode.as_deref()) {
                    qp.append_pair("match", m);
                }
            }
            _ => {
                qp.append_pair("query", query.trim());
            }
        }
        if let Some(o) = non_empty(organism.as_deref()) {
            qp.append_pair("organism", o);
        }
        if let Some(m) = non_empty(modification.as_deref()) {
            qp.append_pair("modification", m);
        }
        qp.append_pair("limit", &limit.unwrap_or(50).min(200).to_string());
    }

    let client = portal_http::client_builder()?
        .build()
        .map_err(|e| format!("portal HTTP client: {e:?}"))?;

    #[derive(serde::Deserialize)]
    struct Raw {
        #[serde(rename = "total_datasets", default)]
        total_datasets: usize,
        #[serde(default)]
        datasets: Vec<PsHit>,
        #[serde(default)]
        unmapped: bool,
    }
    let raw: Raw = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request: {e:?}"))?
        .error_for_status()
        .map_err(|e| format!("http: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse: {e}"))?;
    Ok(PsSearchResult {
        total_datasets: raw.total_datasets,
        datasets: raw.datasets,
        unmapped: raw.unmapped,
    })
}

/// Available PTM modifications on the portal, for the peptide-search filter.
#[tauri::command]
pub async fn ps_modifications() -> Result<Vec<PsModification>, String> {
    #[derive(serde::Deserialize)]
    struct ModsRaw {
        #[serde(default)]
        modifications: Vec<PsModification>,
    }
    let client = portal_http::client_builder()?
        .build()
        .map_err(|e| format!("portal HTTP client: {e:?}"))?;
    let raw: ModsRaw = client
        .get(format!("{BASE}/modifications"))
        .send()
        .await
        .map_err(|e| format!("request: {e:?}"))?
        .error_for_status()
        .map_err(|e| format!("http: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse: {e}"))?;
    Ok(raw.modifications)
}
