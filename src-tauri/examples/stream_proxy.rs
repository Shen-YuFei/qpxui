//! Manual test for the lazy S3 stream proxy: registers s3://<bucket>/<key>, prints
//! a URL DuckDB can range-read, and reports bytes fetched from S3 every 2s.
//! Usage: cargo run --example stream_proxy -- <bucket> <key>
#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (bucket, key) = (&args[1], &args[2]);
    let path = format!("s3://{bucket}/{key}");
    let h = qpxui_lib::stream_register(bucket, &[path.clone()]).await.unwrap();
    println!("URL {}", h[&path].url);
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        if let Some(s) = qpxui_lib::stream_stats().get(&path) {
            println!("STAT fetched={} requests={} size={}", s.fetched_bytes, s.requests, s.size_bytes);
        }
    }
}
