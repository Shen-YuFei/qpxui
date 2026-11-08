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
    pub total_datasets: usize,
    pub datasets: Vec<PsHit>,
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

/// A standard uppercase amino-acid run (>= 8 residues) is read as a peptide sequence;
/// anything else is treated as a protein or gene identifier/name.
fn looks_like_peptide(s: &str) -> bool {
    let t = s.trim();
    t.len() >= 8 && t.bytes().all(|c| b"ACDEFGHIKLMNPQRSTVWY".contains(&c))
}

fn non_empty(v: Option<&str>) -> Option<&str> {
    v.filter(|v| !v.trim().is_empty())
}

/// The portal API URL for one search. With `dtype` "auto" (or none), a
/// peptide-like query goes to the peptide endpoint and anything else to the
/// protein one.
fn search_url(
    query: &str,
    dtype: Option<&str>,
    match_mode: Option<&str>,
    organism: Option<&str>,
    modification: Option<&str>,
    limit: Option<usize>,
) -> Result<reqwest::Url, String> {
    let path = match dtype.unwrap_or("auto").to_lowercase().as_str() {
        "peptide" => "search/peptide",
        "gene" => "search/gene",
        "protein" => "search/protein",
        _ if looks_like_peptide(query) => "search/peptide",
        _ => "search/protein",
    };
    let mut url =
        reqwest::Url::parse(&format!("{BASE}/{path}")).map_err(|e| format!("bad URL: {e}"))?;
    {
        let mut qp = url.query_pairs_mut();
        if path == "search/peptide" {
            qp.append_pair("sequence", query.trim());
            if let Some(m) = non_empty(match_mode) {
                qp.append_pair("match", m);
            }
        } else {
            qp.append_pair("query", query.trim());
        }
        if let Some(o) = non_empty(organism) {
            qp.append_pair("organism", o);
        }
        if let Some(m) = non_empty(modification) {
            qp.append_pair("modification", m);
        }
        qp.append_pair("limit", &limit.unwrap_or(50).min(200).to_string());
    }
    Ok(url)
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
    let url = search_url(
        &query,
        dtype.as_deref(),
        match_mode.as_deref(),
        organism.as_deref(),
        modification.as_deref(),
        limit,
    )?;
    let client = portal_http::client()?;

    #[derive(serde::Deserialize)]
    struct Raw {
        #[serde(default)]
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
    let client = portal_http::client()?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn auto_search_picks_the_endpoint_by_the_query() {
        let url = |q: &str, dtype: Option<&str>| {
            search_url(q, dtype, Some("exact"), None, None, None)
                .unwrap()
                .to_string()
        };
        assert_eq!(
            url("AVGKVLPELNGK", None),
            format!("{BASE}/search/peptide?sequence=AVGKVLPELNGK&match=exact&limit=50")
        );
        assert_eq!(
            url("P04406", Some("auto")),
            format!("{BASE}/search/protein?query=P04406&limit=50")
        );
        assert_eq!(
            url("GAPDH", Some("gene")),
            format!("{BASE}/search/gene?query=GAPDH&limit=50")
        );
        assert_eq!(
            url("ACTB", Some("peptide")),
            format!("{BASE}/search/peptide?sequence=ACTB&match=exact&limit=50")
        );
    }

    #[test]
    fn auto_requires_eight_standard_uppercase_residues() {
        for query in [
            "GAPDH",
            "PEPTIDE",
            "peptidek",
            "PEPTIDEB",
            "PEPTIDEX",
            "PEPTIDEÜ",
        ] {
            let url = search_url(query, Some("auto"), None, None, None, None).unwrap();
            assert_eq!(url.path(), "/peptide-search/search/protein", "{query}");
        }
        for query in ["PEPTIDEK", " PEPTIDEK ", "ACDEFGHIKLMNPQRSTVWY"] {
            let url = search_url(query, Some("auto"), None, None, None, None).unwrap();
            assert_eq!(url.path(), "/peptide-search/search/peptide", "{query}");
        }
    }

    #[test]
    fn search_skips_empty_filters_and_caps_the_limit() {
        let url = search_url(
            " PEPTIDEK ",
            Some("peptide"),
            Some(""),
            Some("Homo sapiens"),
            Some(" "),
            Some(500),
        )
        .unwrap();
        assert_eq!(
            url.to_string(),
            format!("{BASE}/search/peptide?sequence=PEPTIDEK&organism=Homo+sapiens&limit=200")
        );
    }

    #[test]
    fn results_read_snake_case_and_send_camel_case() {
        let hit: PsHit = serde_json::from_value(json!({
            "dataset_accession": "PXD1",
            "dataset_ref": "PXD1/ab",
            "organism_part": "liver",
            "n_peptidoforms": 3,
            "n_peptides": 2,
            "total_obs": 17,
            "sample_peptidoforms": ["PEPK"]
        }))
        .unwrap();
        let result = PsSearchResult {
            total_datasets: 1,
            datasets: vec![hit],
            unmapped: false,
        };
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            json!({
                "totalDatasets": 1,
                "unmapped": false,
                "datasets": [{
                    "datasetAccession": "PXD1",
                    "datasetRef": "PXD1/ab",
                    "collection": null,
                    "organism": null,
                    "organismPart": "liver",
                    "instrument": null,
                    "nPeptidoforms": 3,
                    "nPeptides": 2,
                    "totalObs": 17,
                    "samplePeptidoforms": ["PEPK"]
                }]
            })
        );
        let m: PsModification =
            serde_json::from_value(json!({ "name": "Oxidation", "n_datasets": 4 })).unwrap();
        assert_eq!(
            serde_json::to_value(m).unwrap(),
            json!({ "name": "Oxidation", "nDatasets": 4 })
        );
    }
}
