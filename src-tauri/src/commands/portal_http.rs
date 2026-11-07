use reqwest::{Certificate, Client, ClientBuilder};
use std::path::Path;

const CA_BUNDLE_ENV: &str = "QPXUI_PORTAL_CA_BUNDLE";

pub(super) fn client_builder() -> Result<ClientBuilder, String> {
    let path = std::env::var_os(CA_BUNDLE_ENV);
    client_builder_with_bundle(path.as_deref().map(Path::new))
}

fn client_builder_with_bundle(path: Option<&Path>) -> Result<ClientBuilder, String> {
    let mut builder = Client::builder();
    if let Some(path) = path {
        let pem = std::fs::read(path)
            .map_err(|e| format!("{CA_BUNDLE_ENV}: cannot read {}: {e}", path.display()))?;
        for cert in parse_bundle(&pem, path)? {
            builder = builder.add_root_certificate(cert);
        }
    }
    Ok(builder)
}

fn parse_bundle(pem: &[u8], path: &Path) -> Result<Vec<Certificate>, String> {
    let certs = Certificate::from_pem_bundle(pem).map_err(|e| {
        format!(
            "{CA_BUNDLE_ENV}: invalid PEM bundle {}: {e}",
            path.display()
        )
    })?;
    if certs.is_empty() {
        return Err(format!(
            "{CA_BUNDLE_ENV}: no certificates in {}",
            path.display()
        ));
    }
    Ok(certs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_builds_without_an_extra_bundle() {
        client_builder_with_bundle(None).unwrap().build().unwrap();
    }

    #[test]
    fn parses_every_certificate_in_a_bundle() {
        let first = rcgen::generate_simple_self_signed(vec!["first.example".into()]).unwrap();
        let second = rcgen::generate_simple_self_signed(vec!["second.example".into()]).unwrap();
        let bundle = format!("{}{}", first.cert.pem(), second.cert.pem());
        let certs = parse_bundle(bundle.as_bytes(), Path::new("bundle")).unwrap();
        assert_eq!(certs.len(), 2);
        let mut builder = Client::builder();
        for cert in certs {
            builder = builder.add_root_certificate(cert);
        }
        builder.build().unwrap();
    }

    #[test]
    fn missing_and_invalid_bundles_are_reported() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let missing = root.join("nonexistent-portal-ca-bundle");
        let error = client_builder_with_bundle(Some(&missing)).unwrap_err();
        assert!(error.contains(CA_BUNDLE_ENV));
        assert!(error.contains("cannot read"));

        let invalid = root.join("Cargo.toml");
        let error = client_builder_with_bundle(Some(&invalid)).unwrap_err();
        assert!(error.contains(CA_BUNDLE_ENV));
        assert!(error.contains("no certificates") || error.contains("invalid PEM bundle"));
    }
}
