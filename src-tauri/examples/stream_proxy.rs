//! Manual test for the lazy stream proxy. Registers a remote parquet, prints a
//! URL DuckDB can range-read, and reports bytes fetched every 2s.
//! Usage:
//!   cargo run --example stream_proxy -- <bucket> <key>     (S3)
//!   cargo run --example stream_proxy -- <https-url>        (quantms portal)
#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (path, h) = if args.len() == 2 {
        let url = args[1].clone();
        (url.clone(), qpxui_lib::stream_register_http(&[url]).await.unwrap())
    } else {
        let path = format!("s3://{}/{}", args[1], args[2]);
        (path.clone(), qpxui_lib::stream_register(&args[1], &[path]).await.unwrap())
    };
    println!("URL {}", h[&path].url);
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        if let Some(s) = qpxui_lib::stream_stats().get(&path) {
            println!("STAT fetched={} requests={} size={}", s.fetched_bytes, s.requests, s.size_bytes);
        }
    }
}
