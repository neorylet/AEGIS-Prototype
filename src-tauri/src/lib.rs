mod sensor;
mod discovery;
mod events;
mod detection;
mod fingerprint;
mod intelligence;
mod correlation;
mod incidents;
mod risk;
mod explanation;
mod policy;
mod response;
mod playbooks;
mod ml;
mod forecasting;
mod hunting;
mod integrations;
mod storage;
mod config;
mod commands;

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tokio::sync::Mutex;
use commands::AppState;
use storage::DatabaseManager;
use discovery::AssetRegistry;
use fingerprint::BaselineManager;
use risk::AssetAnomaly;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("❌ Panic: {:?}", panic_info);
        eprintln!("Press Enter to exit...");
        let _ = std::io::stdin().read_line(&mut String::new());
    }));

    let exe_dir = std::env::current_exe()
        .expect("failed to get executable path")
        .parent()
        .expect("failed to get parent directory")
        .to_path_buf();

    let db_path = exe_dir.join("aegis.db")
        .to_str()
        .expect("invalid Unicode in path")
        .to_string();

    println!("📁 Database path: {}", db_path);

    let db = Arc::new(
        tauri::async_runtime::block_on(
            DatabaseManager::new(&format!("sqlite:{}", db_path))
        )
        .expect("Failed to initialize database")
    );

    let baseline_manager = Arc::new(Mutex::new(BaselineManager::new()));

    {
        let db_clone = db.clone();
        let bm_clone = baseline_manager.clone();
        if let Ok(loaded) = tauri::async_runtime::block_on(async move {
            let res = db_clone.load_all_baselines().await?;
            let mut bm = bm_clone.lock().await;
            for (_, bl) in res.iter() {
                bm.merge_loaded(bl.clone());
            }
            let n = bm.len();
            if n > 0 {
                println!("📊 Loaded {} historical baselines from DB", n);
            }
            anyhow::Ok(())
        }) {
            let _ = loaded;
        }
    }

    let app_state = AppState {
        db,
        is_monitoring: AtomicBool::new(false),
        asset_registry: Arc::new(Mutex::new(AssetRegistry::new())),
        baseline_manager,
        anomalies: Arc::new(Mutex::new(Vec::<AssetAnomaly>::new())),
    };

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::start_monitoring,
            commands::stop_monitoring,
            commands::get_recent_events,
            commands::get_anomalies,
            commands::get_asset_count,
            commands::get_event_counts,
            commands::get_hourly_events_24h,
            commands::get_alerts,
            commands::acknowledge_alert,
            commands::resolve_alert,
            commands::get_alert_details,
            commands::count_open_alerts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}