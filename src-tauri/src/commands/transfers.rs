//! Cooperative cancellation for long-running downloads (big S3 / portal
//! parquet views). The frontend generates a unique `cancelId` per batch, the
//! Rust command registers a shared cancel token under that id, and checks it
//! between every chunk. `cancel_download(id)` flips the token; the loop then
//! aborts promptly instead of streaming the whole file.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

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

/// Tauri command: cancel an in-flight download batch by its `cancelId`.
#[tauri::command]
pub fn cancel_download(id: String) -> Result<(), String> {
    if cancel(&id) {
        Ok(())
    } else {
        Err("no such in-flight download".to_string())
    }
}
