use tauri::State;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;
use tokio::spawn;
use crate::storage::DatabaseManager;
use crate::sensor::capture::{poll_processes, poll_connections, run_analysis_loop};
use crate::events::EnrichedEvent;
use crate::discovery::AssetRegistry;
use crate::fingerprint::BaselineManager;
use crate::risk::AssetAnomaly;

pub struct AppState {
    pub db: Arc<DatabaseManager>,
    pub is_monitoring: AtomicBool,
    pub asset_registry: Arc<Mutex<AssetRegistry>>,
    pub baseline_manager: Arc<Mutex<BaselineManager>>,
    pub anomalies: Arc<Mutex<Vec<AssetAnomaly>>>,
}

#[tauri::command]
pub async fn start_monitoring(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if state.is_monitoring.swap(true, Ordering::SeqCst) {
        log::warn!("start_monitoring called while already running — ignoring");
        return Ok(());
    }
    log::info!("🚀 Starting AEGIS monitoring pipeline...");

    let db = state.db.clone();
    let app_clone = app.clone();
    spawn(async move {
        poll_processes(db, app_clone).await;
    });

    let db2 = state.db.clone();
    let app_clone2 = app.clone();
    spawn(async move {
        poll_connections(db2, app_clone2).await;
    });

    let db3 = state.db.clone();
    let ar = state.asset_registry.clone();
    let bm = state.baseline_manager.clone();
    let anom = state.anomalies.clone();
    spawn(async move {
        run_analysis_loop(db3, ar, bm, anom).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    if state.is_monitoring.swap(false, Ordering::SeqCst) {
        log::info!("🛑 Monitoring stop requested (advisory flag set)");
    }
    Ok(())
}

#[tauri::command]
pub async fn get_recent_events(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<EnrichedEvent>, String> {
    state.db.get_recent_events(limit).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_anomalies(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<AssetAnomaly>, String> {
    let guard = state.anomalies.lock().await;
    let limit = limit.min(guard.len());
    Ok(guard.iter().take(limit).cloned().collect())
}

#[tauri::command]
pub async fn get_asset_count(state: State<'_, AppState>) -> Result<i64, String> {
    state.db.get_asset_count().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_event_counts(
    state: State<'_, AppState>,
) -> Result<crate::storage::EventCounts, String> {
    state.db.get_event_counts().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_hourly_events_24h(
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::HourlyEvents>, String> {
    state.db.get_events_per_hour_24h().await.map_err(|e| e.to_string())
}

pub mod devices;
pub mod traffic;
pub mod alerts;
pub mod incidents;
pub mod response;