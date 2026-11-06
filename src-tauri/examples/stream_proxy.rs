//! Manual test for the lazy stream proxy. Registers remote parquets, prints a
//! URL DuckDB can range-read for each, and reports bytes fetched every 2s.
//! Usage:
//!   cargo run --example stream_proxy -- <bucket> <key>         (S3)
//!   cargo run --example stream_proxy -- <https-url> [<url>...] (quantms portal)
#[tokio::main]
async fn main() {
    env_logger::init();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (paths, h) = if args[0].starts_with("http") {
        (args.clone(), qpxui_lib::stream_register_http(&args).await.unwrap())
    } else {
        let path = format!("s3://{}/{}", args[0], args[1]);
        (vec![path.clone()], qpxui_lib::stream_register(&args[0], &[path]).await.unwrap())
    };
    for p in &paths {
        println!("URL {p} {}", h[p].url);
    }
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        for (p, s) in qpxui_lib::stream_stats() {
            println!("STAT {p} fetched={} requests={} size={}", s.fetched_bytes, s.requests, s.size_bytes);
        }
    }
}
