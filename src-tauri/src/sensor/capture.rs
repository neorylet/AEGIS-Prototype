use sysinfo::System;
use crate::events::{ProcessEvent, SecurityEvent, EnrichedEvent, NetworkEvent};
use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::Duration;
use std::collections::HashSet;
use chrono::{Utc, Duration as ChronoDuration};
use crate::storage::DatabaseManager;
use crate::discovery::AssetRegistry;
use crate::fingerprint::{BaselineManager, FeatureExtractor};
use crate::risk::{AssetAnomaly, run_detection_pipeline, format_anomaly_summary};
use log::{info, error, warn, debug};
use tauri::{AppHandle, Manager};

/// Helper: Safely parses IP and port from "127.0.0.1:8080", "[::1]:443", or "*:*"
fn parse_address(address: &str) -> (String, u16) {
    if let Some(last_colon) = address.rfind(':') {
        let raw_ip = &address[..last_colon];
        let ip = raw_ip.trim_start_matches('[').trim_end_matches(']').to_string();
        let port = address[last_colon + 1..]
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<u16>()
            .unwrap_or(0);
        (ip, port)
    } else {
        (address.to_string(), 0)
    }
}

// ============================================================================
// PROCESS POLLER
// ============================================================================
pub async fn poll_processes(db: Arc<DatabaseManager>, app: AppHandle) {
    let mut sys = System::new_all();
    let mut previous_pids: HashSet<u32> = HashSet::new();

    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;

        // FIXED: Guaranteed re-initialization on both Ok and Err arms
        sys = match tokio::task::spawn_blocking(move || {
            sys.refresh_processes();
            sys
        })
        .await
        {
            Ok(refreshed_sys) => refreshed_sys,
            Err(e) => {
                error!("Process poller blocking task panicked: {}", e);
                System::new_all() // Ensures `sys` is never left in an uninitialized moved state
            }
        };

        let mut current_pids: HashSet<u32> = HashSet::new();
        let mut new_events: Vec<EnrichedEvent> = Vec::new();

        for (pid, process) in sys.processes() {
            let pid_u32 = pid.as_u32();
            current_pids.insert(pid_u32);

            if !previous_pids.contains(&pid_u32) {
                let process_event = ProcessEvent {
                    pid: pid_u32,
                    name: process.name().to_string(),
                    parent_pid: process.parent().map(|p| p.as_u32()),
                    cpu_usage: process.cpu_usage(),
                    memory_usage: process.memory(),
                };
                let event = EnrichedEvent::new(
                    "process_poller",
                    SecurityEvent::Process(process_event.clone()),
                );

                if let Err(e) = db.insert_event(&event).await {
                    error!("Failed to insert process event: {}", e);
                } else {
                    println!(
                        "[DEBUG] Process: PID={}, Name={}, CPU={:.1}%, RAM={:.1}MB",
                        process_event.pid,
                        process_event.name,
                        process_event.cpu_usage,
                        (process_event.memory_usage as f64) / 1024.0 / 1024.0
                    );
                    new_events.push(event);
                }
            }
        }

        // Dual emission: supports both single and batch listeners
        if !new_events.is_empty() {
            for event in &new_events {
                let _ = app.emit_all("new-event", event);
            }
            let _ = app.emit_all("new-events-batch", &new_events);
        }

        info!(
            "Polled {} processes ({} new since last poll)",
            current_pids.len(),
            current_pids.difference(&previous_pids).count()
        );

        previous_pids = current_pids;
    }
}

// ============================================================================
// CONNECTION POLLER
// ============================================================================
pub async fn poll_connections(db: Arc<DatabaseManager>, app: AppHandle) {
    let mut previous_keys: HashSet<String> = HashSet::new();

    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;

        // On Windows, use CREATE_NO_WINDOW (0x08000000) to prevent black console popups
        let output = match tokio::task::spawn_blocking(|| {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                std::process::Command::new("netstat")
                    .args(["-an"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
            }
            #[cfg(not(target_os = "windows"))]
            {
                std::process::Command::new("netstat").args(["-an"]).output()
            }
        })
        .await
        {
            Ok(Ok(output)) => output,
            Ok(Err(e)) => {
                error!("Failed to execute netstat: {}", e);
                continue;
            }
            Err(e) => {
                error!("netstat blocking task panicked: {}", e);
                continue;
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut current_keys: HashSet<String> = HashSet::new();
        let mut new_events: Vec<EnrichedEvent> = Vec::new();

        for line in stdout.lines() {
            let line = line.trim();

            if line.is_empty()
                || line.starts_with("Active Connections")
                || line.starts_with("Proto")
                || line.starts_with("---")
            {
                continue;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 {
                continue;
            }

            let protocol = parts[0].to_string();
            let local_address = parts[1];
            let foreign_address = parts[2];
            let state = if parts.len() > 3 { parts[3].to_string() } else { String::new() };

            let key = format!("{}|{}|{}|{}", protocol, local_address, foreign_address, state);
            current_keys.insert(key.clone());

            if !previous_keys.contains(&key) {
                let (local_ip, local_port) = parse_address(local_address);
                let (remote_ip, remote_port) = parse_address(foreign_address);

                let network_event = NetworkEvent {
                    local_ip: local_ip.clone(),
                    local_port,
                    remote_ip: remote_ip.clone(),
                    remote_port,
                    protocol: protocol.clone(),
                };

                let event = EnrichedEvent::new(
                    "connection_poller",
                    SecurityEvent::Network(network_event),
                );

                if let Err(e) = db.insert_event(&event).await {
                    error!("Failed to insert connection event: {}", e);
                } else {
                    println!(
                        "[DEBUG] Connection: {} {}:{} -> {}:{}",
                        protocol, local_ip, local_port, remote_ip, remote_port
                    );
                    new_events.push(event);
                }
            }
        }

        if !new_events.is_empty() {
            for event in &new_events {
                let _ = app.emit_all("new-event", event);
            }
            let _ = app.emit_all("new-events-batch", &new_events);
        }

        info!(
            "Polled {} connections ({} new)",
            current_keys.len(),
            current_keys.difference(&previous_keys).count()
        );

        previous_keys = current_keys;
    }
}

// ============================================================================
// ANALYSIS & RISK PIPELINE LOOP
// ============================================================================
pub async fn run_analysis_loop(
    db: Arc<DatabaseManager>,
    asset_registry: Arc<Mutex<AssetRegistry>>,
    baseline_manager: Arc<Mutex<BaselineManager>>,
    anomalies_cache: Arc<Mutex<Vec<AssetAnomaly>>>,
) {
    let extractor = FeatureExtractor::new();
    let analysis_interval_secs: i64 = 15;
    let window_minutes: i64 = 10;
    let persist_every_n: u64 = 4;
    let mut tick: u64 = 0;

    loop {
        tokio::time::sleep(Duration::from_secs(analysis_interval_secs as u64)).await;
        tick = tick.wrapping_add(1);

        let window_start = Utc::now() - ChronoDuration::minutes(window_minutes);
        let recent_events = match db.get_events_since(window_start, 2000).await {
            Ok(e) => e,
            Err(err) => {
                error!("Analysis: failed to fetch events: {}", err);
                continue;
            }
        };

        if recent_events.is_empty() {
            continue;
        }

        info!(
            "🔍 Analysis tick #{}: {} events in last {} min window",
            tick, recent_events.len(), window_minutes
        );

        let updated_ids = {
            let mut ar = asset_registry.lock().await;
            ar.ingest_events(&recent_events)
        };

        // FIXED: Clone assets and drop lock before async DB writes, and use asset.asset_id
        if !updated_ids.is_empty() {
            let assets_to_persist: Vec<_> = {
                let ar_guard = asset_registry.lock().await;
                updated_ids
                    .iter()
                    .take(100)
                    .filter_map(|aid| ar_guard.get(aid).cloned())
                    .collect()
            };

            for asset in &assets_to_persist {
                if let Err(e) = db.upsert_asset(asset).await {
                    error!("Failed to persist asset {}: {}", asset.asset_id, e);
                }
            }
            info!("  → {} assets tracked in registry", updated_ids.len());
        }

        let features = extractor.extract_per_asset(&recent_events);

        let (baselines_snapshot, new_anomalies) = {
            let mut bm = baseline_manager.lock().await;
            bm.ingest_features(&features);
            let snapshot = bm.all_baselines().iter().map(|b| (*b).clone()).collect::<Vec<_>>();
            let (_, anomalies) = run_detection_pipeline(&recent_events, &bm);
            (snapshot, anomalies)
        };

        if tick % persist_every_n == 0 {
            let candidates: Vec<_> = baselines_snapshot
                .iter()
                .filter(|b| b.window_count >= 2)
                .collect();

            let mut baselines_written = 0usize;
            let mut rows_written = 0usize;
            let mut empty_stats_count = 0usize;

            for bl in candidates.iter() {
                if bl.stats.is_empty() {
                    empty_stats_count += 1;
                    warn!(
                        "Baseline for asset '{}' has window_count={} but stats map is EMPTY",
                        bl.asset_id, bl.window_count
                    );
                    continue;
                }
                match db.save_baseline(bl).await {
                    Ok(n) => {
                        baselines_written += 1;
                        rows_written += n;
                    }
                    Err(e) => {
                        error!("Failed to persist baseline for asset '{}': {}", bl.asset_id, e);
                    }
                }
            }

            info!(
                "  → Baselines: {} candidates (window_count>=2) | {} written ({} rows total) | {} empty stats",
                candidates.len(),
                baselines_written,
                rows_written,
                empty_stats_count,
            );
        }

        // Always update anomalies_cache so UI properly clears when anomalies resolve
        {
            let mut cache = anomalies_cache.lock().await;
            *cache = new_anomalies.clone();
        }

        if !new_anomalies.is_empty() {
            info!("  ⚠️  {} anomaly/anomalies detected:", new_anomalies.len());
            for a in new_anomalies.iter().take(5) {
                info!("    {}", format_anomaly_summary(a));
            }
            if new_anomalies.len() > 5 {
                info!("    ... and {} more", new_anomalies.len() - 5);
            }
        } else if tick % 4 == 0 {
            info!("  → No anomalies detected this tick (system behavior normal)");
        }
    }
}