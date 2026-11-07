//! Cooperative cancellation for long-running downloads (big S3 / portal
//! parquet views). The frontend generates a unique `cancelId` per batch, the
//! Rust command registers a shared cancel token under that id, and checks it
//! between every chunk. `cancel_download(id)` flips the token; the loop then
//! aborts promptly instead of streaming the whole file.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::io::AsyncWriteExt;

static ACTIVE: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a download batch and return its token. Call [`end`] when the
/// command returns, so the registry doesn't grow unboundedly.
pub fn begin(id: &str) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    registry()
        .lock()
        .expect("transfers registry poisoned")
        .insert(id.to_string(), token.clone());
    token
}

/// Remove a finished (or failed) download from the registry.
pub fn end(id: &str) {
    registry()
        .lock()
        .expect("transfers registry poisoned")
        .remove(id);
}

/// Request cancellation for a batch. Returns whether a matching download
/// existed. Setting the token is asynchronous: the running loop observes it
/// at the next chunk boundary.
pub fn cancel(id: &str) -> bool {
    let hit = {
        let guard = registry().lock().expect("transfers registry poisoned");
        guard.get(id).map(|t| t.clone())
    };
    match hit {
        Some(token) => {
            token.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

/// Poll helper for the download loop.
pub fn is_cancelled(token: &AtomicBool) -> bool {
    token.load(Ordering::Relaxed)
}

/// Run `fut`, aborting as soon as the cancel token is set, even while `fut`
/// is still waiting for the server to reply (an in-flight `send()` with no
/// data yet — that phase had no chunk loop to poll it). Wrapping a request in
/// this means cancel always takes effect within [`POLL`], never only at the
/// next body chunk. The two branches of `select!` never both resolve, so a
/// finished future is returned exact, not dropped.
pub async fn cancellable<T, F>(token: &AtomicBool, fut: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    tokio::pin!(fut);
    let mut tick = tokio::time::interval(POLL);
    tick.tick().await; // consume the immediate first tick
    loop {
        tokio::select! {
            r = &mut fut => return r,
            _ = tick.tick() => {
                if is_cancelled(token) {
                    return Err("cancelled".to_string());
                }
            }
        }
    }
}

/// Tauri command: cancel an in-flight download batch by its `cancelId`.
#[tauri::command]
pub fn cancel_download(id: String) -> Result<(), String> {
    if cancel(&id) {
        Ok(())
    } else {
        Err("no such in-flight download".to_string())
    }
}

/// How often a stalled download re-checks its cancel token.
pub const POLL: std::time::Duration = std::time::Duration::from_millis(250);

/// Space left free on the cache volume after a download, so a big transfer
/// never fills the disk to the last byte.
pub const RESERVE_BYTES: u64 = 1 << 30;

/// Free bytes on the volume holding `dir` (walks up to the nearest existing
/// ancestor, since cache sub-folders may not exist yet).
pub fn free_space(dir: &Path) -> Result<u64, String> {
    let mut p = dir;
    while !p.exists() {
        p = p.parent().ok_or_else(|| format!("no existing parent for {}", dir.display()))?;
    }
    fs4::available_space(p).map_err(|e| format!("free space of {}: {e}", p.display()))
}

/// Human-readable size (binary units), for error messages.
pub fn human(n: u64) -> String {
    const U: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < U.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 { format!("{n} B") } else { format!("{v:.1} {}", U[i]) }
}

/// Fail when `need` bytes (plus [`RESERVE_BYTES`]) do not fit in `free`.
pub fn check_fits(need: u64, free: u64) -> Result<(), String> {
    if need.saturating_add(RESERVE_BYTES) > free {
        return Err(format!(
            "Not enough disk space: the download needs {}, but only {} is free on the cache disk (keeping {} spare). Free some space or use Stream instead.",
            human(need),
            human(free),
            human(RESERVE_BYTES)
        ));
    }
    Ok(())
}

/// Check that `need` bytes fit on the volume holding `dir`.
pub fn ensure_space(dir: &Path, need: u64) -> Result<(), String> {
    check_fits(need, free_space(dir)?)
}

/// A download in progress: bytes go to `<final>.part`, which is renamed to the
/// final name by [`PartFile::finish`]. Dropping it unfinished (error, cancel)
/// deletes the partial file, so the cache never holds a truncated parquet.
pub struct PartFile {
    part: PathBuf,
    dest: PathBuf,
    file: Option<tokio::fs::File>,
    pub written: u64,
}

impl PartFile {
    pub async fn create(dest: &Path) -> Result<Self, String> {
        let mut name = dest.file_name().unwrap_or_default().to_os_string();
        name.push(".part");
        let part = dest.with_file_name(name);
        let file = tokio::fs::File::create(&part)
            .await
            .map_err(|e| format!("create {}: {e}", part.display()))?;
        Ok(Self { part, dest: dest.to_path_buf(), file: Some(file), written: 0 })
    }

    pub async fn write(&mut self, chunk: &[u8]) -> Result<(), String> {
        let f = self.file.as_mut().ok_or("download already finished")?;
        f.write_all(chunk).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::StorageFull {
                "Not enough disk space: the cache disk filled up during the download; the partial file was removed.".to_string()
            } else {
                format!("write {}: {e}", self.part.display())
            }
        })?;
        self.written += chunk.len() as u64;
        Ok(())
    }

    pub async fn finish(mut self) -> Result<u64, String> {
        if let Some(mut f) = self.file.take() {
            f.flush().await.map_err(|e| e.to_string())?;
            f.sync_all().await.map_err(|e| e.to_string())?;
        }
        tokio::fs::rename(&self.part, &self.dest)
            .await
            .map_err(|e| format!("rename {}: {e}", self.part.display()))?;
        self.part = PathBuf::new();
        Ok(self.written)
    }
}

impl Drop for PartFile {
    fn drop(&mut self) {
        self.file.take();
        if !self.part.as_os_str().is_empty() {
            let _ = std::fs::remove_file(&self.part);
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpace {
    pub free: u64,
    pub reserve: u64,
    pub dir: String,
}

/// Tauri command: free space on the download cache volume (`kind` is
/// `portal` or `s3`), so the UI can warn before starting a download.
#[tauri::command]
pub fn cache_free_space(kind: String) -> Result<DiskSpace, String> {
    let base = dirs::cache_dir()
        .or_else(dirs::data_local_dir)
        .ok_or_else(|| "no cache directory available".to_string())?;
    let dir = base.join("qpxui").join(if kind == "s3" { "s3-cache" } else { "portal" });
    Ok(DiskSpace { free: free_space(&dir)?, reserve: RESERVE_BYTES, dir: dir.to_string_lossy().to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn space_check_keeps_a_reserve() {
        let gb = 1u64 << 30;
        assert!(check_fits(10 * gb, 20 * gb).is_ok());
        let e = check_fits(24 * gb, 20 * gb).unwrap_err();
        assert!(e.starts_with("Not enough disk space"), "{e}");
        assert!(e.contains("24.0 GB") && e.contains("20.0 GB"), "{e}");
        // Fits exactly only with the reserve left over.
        assert!(check_fits(19 * gb, 20 * gb).is_ok());
        assert!(check_fits(19 * gb + 1, 20 * gb).is_err());
    }

    #[test]
    fn free_space_walks_up_to_an_existing_dir() {
        let p = std::env::temp_dir().join("qpxui-nope").join("deeper");
        assert!(free_space(&p).unwrap() > 0);
    }

    #[tokio::test]
    async fn part_file_is_removed_unless_finished() {
        let dir = std::env::temp_dir().join(format!("qpxui-part-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("x.feature.parquet");
        let part = dir.join("x.feature.parquet.part");

        let mut f = PartFile::create(&dest).await.unwrap();
        f.write(b"abc").await.unwrap();
        assert!(part.exists());
        drop(f); // cancelled / failed
        assert!(!part.exists() && !dest.exists());

        let mut f = PartFile::create(&dest).await.unwrap();
        f.write(b"abcdef").await.unwrap();
        assert_eq!(f.finish().await.unwrap(), 6);
        assert!(!part.exists());
        assert_eq!(std::fs::read(&dest).unwrap(), b"abcdef");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
