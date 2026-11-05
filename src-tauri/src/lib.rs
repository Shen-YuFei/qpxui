mod commands;
mod qpx;

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::sources::open_file,
            commands::sources::scan_folder,
            commands::sources::scan_collection,
            commands::io::read_file_bytes,
            commands::s3::list_s3,
            commands::s3::cache_s3_views,
            commands::s3::presign_s3_urls,
            commands::transfers::cancel_download,
            commands::portal::portal_datasets,
            commands::portal::portal_registry,
            commands::portal::portal_list_views,
            commands::portal::portal_cache_views,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
