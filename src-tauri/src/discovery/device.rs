use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::events::{EnrichedEvent, SecurityEvent, NetworkEvent, ProcessEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub asset_id: String,
    pub asset_type: AssetType,
    pub ip_address: Option<String>,
    pub process_name: Option<String>,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub event_count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssetType {
    NetworkEndpoint,
    Process,
    Device,
}

impl std::fmt::Display for AssetType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AssetType::NetworkEndpoint => write!(f, "NetworkEndpoint"),
            AssetType::Process => write!(f, "Process"),
            AssetType::Device => write!(f, "Device"),
        }
    }
}

pub struct AssetRegistry {
    assets: HashMap<String, Asset>,
}

impl AssetRegistry {
    pub fn new() -> Self {
        Self {
            assets: HashMap::new(),
        }
    }

    pub fn ingest_event(&mut self, event: &EnrichedEvent) -> Vec<String> {
        let now = Utc::now();
        let mut updated_ids = Vec::new();

        match &event.event {
            SecurityEvent::Network(net) => {
                for ip in [net.local_ip.as_str(), net.remote_ip.as_str()] {
                    if is_loopback_or_unspecified(ip) {
                        continue;
                    }
                    let asset_id = format!("net:{}", ip);
                    let asset = self.assets.entry(asset_id.clone()).or_insert_with(|| Asset {
                        asset_id: asset_id.clone(),
                        asset_type: AssetType::NetworkEndpoint,
                        ip_address: Some(ip.to_string()),
                        process_name: None,
                        first_seen: now,
                        last_seen: now,
                        event_count: 0,
                    });
                    asset.last_seen = now;
                    asset.event_count = asset.event_count.saturating_add(1);
                    updated_ids.push(asset_id);
                }
            }
            SecurityEvent::Process(proc) => {
                let asset_id = format!("proc:{}:{}", proc.name, proc.pid);
                let asset = self.assets.entry(asset_id.clone()).or_insert_with(|| Asset {
                    asset_id: asset_id.clone(),
                    asset_type: AssetType::Process,
                    ip_address: None,
                    process_name: Some(proc.name.clone()),
                    first_seen: now,
                    last_seen: now,
                    event_count: 0,
                });
                asset.last_seen = now;
                asset.event_count = asset.event_count.saturating_add(1);
                updated_ids.push(asset_id);
            }
        }

        updated_ids
    }

    pub fn ingest_events(&mut self, events: &[EnrichedEvent]) -> Vec<String> {
        let mut all_updated = Vec::new();
        for e in events {
            all_updated.extend(self.ingest_event(e));
        }
        all_updated
    }

    pub fn get(&self, asset_id: &str) -> Option<&Asset> {
        self.assets.get(asset_id)
    }

    pub fn all_assets(&self) -> Vec<&Asset> {
        self.assets.values().collect()
    }

    pub fn network_assets(&self) -> Vec<&Asset> {
        self.assets.values().filter(|a| matches!(a.asset_type, AssetType::NetworkEndpoint)).collect()
    }

    pub fn process_assets(&self) -> Vec<&Asset> {
        self.assets.values().filter(|a| matches!(a.asset_type, AssetType::Process)).collect()
    }

    pub fn len(&self) -> usize {
        self.assets.len()
    }

    pub fn is_empty(&self) -> bool {
        self.assets.is_empty()
    }
}

impl Default for AssetRegistry {
    fn default() -> Self {
        Self::new()
    }
}

fn is_loopback_or_unspecified(ip: &str) -> bool {
    matches!(ip,
        "127.0.0.1"
        | "0.0.0.0"
        | "::"
        | "::1"
        | "*"
        | ""
    ) || ip.starts_with("[::")
}

pub fn extract_network_from_event(event: &EnrichedEvent) -> Option<&NetworkEvent> {
    if let SecurityEvent::Network(n) = &event.event {
        Some(n)
    } else {
        None
    }
}

pub fn extract_process_from_event(event: &EnrichedEvent) -> Option<&ProcessEvent> {
    if let SecurityEvent::Process(p) = &event.event {
        Some(p)
    } else {
        None
    }
}

pub fn asset_id_for_network_ip(ip: &str) -> String {
    format!("net:{}", ip)
}

pub fn asset_id_for_process(name: &str, pid: u32) -> String {
    format!("proc:{}:{}", name, pid)
}
