use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteConnectOptions};
use sqlx::Row;
use chrono::{DateTime, Utc, Duration};
use serde_json;
use crate::events::{EnrichedEvent, SecurityEvent};
use crate::fingerprint::{Baseline, BaselineStats};
use crate::discovery::Asset;
use crate::risk::{AssetAnomaly, FeatureDeviation};
use anyhow::Result;
use log::info;
use std::collections::HashMap;
use std::str::FromStr;
use std::path::Path;

pub struct DatabaseManager {
    pool: SqlitePool,
}

impl DatabaseManager {
    pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        info!("Connecting to database: {}", database_url);

        let path_str = database_url.trim_start_matches("sqlite:");
        if let Some(parent) = Path::new(path_str).parent() {
            std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
        }

        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;

        info!("Database connected, initializing tables...");
        Self::initialize_tables(&pool).await?;
        info!("Tables initialized successfully");
        Ok(Self { pool })
    }

    async fn initialize_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
        match sqlx::query(
            "CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                source TEXT NOT NULL,
                asset_id TEXT,
                event_type TEXT NOT NULL,
                event_data TEXT NOT NULL
            )",
        )
        .execute(pool)
        .await
        {
            Ok(_) => info!("✅ events table ready"),
            Err(e) => {
                log::error!("❌ events CREATE TABLE FAILED: {:?}", e);
                return Err(e);
            }
        }

        match sqlx::query(
            "CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                asset_type TEXT NOT NULL DEFAULT 'device',
                ip_address TEXT,
                process_name TEXT,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                event_count INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(pool)
        .await
        {
            Ok(_) => info!("✅ assets table ready"),
            Err(e) => {
                log::error!("❌ assets CREATE TABLE FAILED: {:?}", e);
                return Err(e);
            }
        }

        match sqlx::query(
            "CREATE TABLE IF NOT EXISTS baselines (
                asset_id TEXT NOT NULL,
                feature_name TEXT NOT NULL,
                mean REAL NOT NULL,
                stddev REAL NOT NULL,
                min REAL NOT NULL,
                max REAL NOT NULL,
                sample_count INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (asset_id, feature_name)
            )",
        )
        .execute(pool)
        .await
        {
            Ok(_) => info!("✅ baselines table ready"),
            Err(e) => {
                log::error!("❌ baselines CREATE TABLE FAILED: {:?}", e);
                return Err(e);
            }
        }

        match sqlx::query(
            "CREATE TABLE IF NOT EXISTS anomalies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                display_name TEXT NOT NULL,
                severity TEXT NOT NULL,
                max_severity TEXT NOT NULL,
                overall_score REAL NOT NULL,
                deviations_json TEXT NOT NULL,
                detected_at TEXT NOT NULL,
                status TEXT DEFAULT 'Open',
                acknowledged_at TEXT,
                resolved_at TEXT,
                cooldown_until TEXT
            )",
        )
        .execute(pool)
        .await
        {
            Ok(_) => info!("✅ anomalies table ready"),
            Err(e) => {
                log::error!("❌ anomalies CREATE TABLE FAILED: {:?}", e);
                return Err(e);
            }
        }

        Ok(())
    }

    pub async fn insert_event(&self, event: &EnrichedEvent) -> Result<(), anyhow::Error> {
        let event_type = match &event.event {
            SecurityEvent::Process(_) => "process",
            SecurityEvent::Network(_) => "network",
        };

        let event_data = serde_json::to_string(&event.event)?;

        sqlx::query(
            "INSERT INTO events (timestamp, source, asset_id, event_type, event_data)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(event.timestamp.to_rfc3339())
        .bind(&event.source)
        .bind(event.asset_id.clone().unwrap_or_else(|| "unknown".to_string()))
        .bind(event_type)
        .bind(&event_data)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_recent_events(&self, limit: usize) -> Result<Vec<EnrichedEvent>, anyhow::Error> {
        let rows = sqlx::query(
            "SELECT id, timestamp, source, asset_id, event_type, event_data
             FROM events ORDER BY timestamp DESC LIMIT ?1"
        )
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut results = Vec::new();
        for row in rows {
            let id: i64 = row.get(0);
            let timestamp_str: String = row.get(1);
            let timestamp = DateTime::parse_from_rfc3339(&timestamp_str)
                .unwrap()
                .with_timezone(&Utc);
            let source: String = row.get(2);
            let asset_id: String = row.get(3);
            let event_data: String = row.get(5);

            let event: SecurityEvent = serde_json::from_str(&event_data)?;

            results.push(EnrichedEvent {
                id: Some(id),
                timestamp,
                source,
                asset_id: Some(asset_id),
                event,
            });
        }

        Ok(results)
    }

    pub async fn get_events_since(&self, since: DateTime<Utc>, limit: usize) -> Result<Vec<EnrichedEvent>, anyhow::Error> {
        let rows = sqlx::query(
            "SELECT id, timestamp, source, asset_id, event_type, event_data
             FROM events WHERE timestamp >= ?1 ORDER BY timestamp DESC LIMIT ?2"
        )
        .bind(since.to_rfc3339())
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut results = Vec::new();
        for row in rows {
            let id: i64 = row.get(0);
            let timestamp_str: String = row.get(1);
            let timestamp = DateTime::parse_from_rfc3339(&timestamp_str)
                .unwrap()
                .with_timezone(&Utc);
            let source: String = row.get(2);
            let asset_id: String = row.get(3);
            let event_data: String = row.get(5);
            let event: SecurityEvent = serde_json::from_str(&event_data)?;
            results.push(EnrichedEvent {
                id: Some(id),
                timestamp,
                source,
                asset_id: Some(asset_id),
                event,
            });
        }
        Ok(results)
    }

    pub async fn upsert_asset(&self, asset: &Asset) -> Result<(), anyhow::Error> {
        let asset_type_str = match asset.asset_type {
            crate::discovery::AssetType::NetworkEndpoint => "network",
            crate::discovery::AssetType::Process => "process",
            crate::discovery::AssetType::Device => "device",
        };
        sqlx::query(
            "INSERT INTO assets (id, asset_type, ip_address, process_name, first_seen, last_seen, event_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                asset_type = excluded.asset_type,
                ip_address = COALESCE(excluded.ip_address, assets.ip_address),
                process_name = COALESCE(excluded.process_name, assets.process_name),
                last_seen = excluded.last_seen,
                event_count = assets.event_count + 1"
        )
        .bind(&asset.asset_id)
        .bind(asset_type_str)
        .bind(&asset.ip_address)
        .bind(&asset.process_name)
        .bind(asset.first_seen.to_rfc3339())
        .bind(asset.last_seen.to_rfc3339())
        .bind(asset.event_count as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn upsert_baseline_stats(
        &self,
        asset_id: &str,
        feature_name: &str,
        stats: &BaselineStats,
        updated_at: DateTime<Utc>,
    ) -> Result<(), anyhow::Error> {
        sqlx::query(
            "INSERT INTO baselines (asset_id, feature_name, mean, stddev, min, max, sample_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(asset_id, feature_name) DO UPDATE SET
                mean = excluded.mean,
                stddev = excluded.stddev,
                min = excluded.min,
                max = excluded.max,
                sample_count = excluded.sample_count,
                updated_at = excluded.updated_at"
        )
        .bind(asset_id)
        .bind(feature_name)
        .bind(stats.mean)
        .bind(stats.stddev)
        .bind(stats.min)
        .bind(stats.max)
        .bind(stats.sample_count as i64)
        .bind(updated_at.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Returns the number of (asset_id, feature_name) rows actually written.
    /// If `baseline.stats` is empty, this returns Ok(0) and writes nothing —
    /// that used to look identical to "success" in the caller's logs.
    pub async fn save_baseline(&self, baseline: &Baseline) -> Result<usize, anyhow::Error> {
        let mut written = 0usize;
        for (feature_name, stats) in &baseline.stats {
            self.upsert_baseline_stats(&baseline.asset_id, feature_name, stats, baseline.updated_at).await?;
            written += 1;
        }
        Ok(written)
    }

    pub async fn load_all_baselines(&self) -> Result<HashMap<String, Baseline>, anyhow::Error> {
        let rows = sqlx::query(
            "SELECT b.asset_id, b.feature_name, b.mean, b.stddev, b.min, b.max, b.sample_count, b.created_at, b.updated_at,
                    COALESCE(a.asset_type, 'device') as asset_type
             FROM baselines b
             LEFT JOIN assets a ON b.asset_id = a.id
             ORDER BY b.asset_id, b.feature_name"
        )
        .fetch_all(&self.pool)
        .await?;

        let mut map: HashMap<String, Baseline> = HashMap::new();
        for row in rows {
            let asset_id: String = row.get(0);
            let feature_name: String = row.get(1);
            let mean: f64 = row.get(2);
            let stddev: f64 = row.get(3);
            let min: f64 = row.get(4);
            let max: f64 = row.get(5);
            let sample_count: i64 = row.get(6);
            let created_at_str: String = row.get(7);
            let updated_at_str: String = row.get(8);
            let asset_type_str: String = row.get(9);

            let asset_type = match asset_type_str.as_str() {
                "network" => crate::discovery::AssetType::NetworkEndpoint,
                "process" => crate::discovery::AssetType::Process,
                _ => crate::discovery::AssetType::Device,
            };

            let created_at = DateTime::parse_from_rfc3339(&created_at_str)?.with_timezone(&Utc);
            let updated_at = DateTime::parse_from_rfc3339(&updated_at_str)?.with_timezone(&Utc);

            let bl = map.entry(asset_id.clone()).or_insert_with(|| Baseline {
                asset_id: asset_id.clone(),
                asset_type,
                created_at,
                updated_at,
                window_count: sample_count as u64,
                stats: HashMap::new(),
            });
            bl.updated_at = updated_at;
            bl.stats.insert(feature_name, BaselineStats {
                mean,
                stddev,
                min,
                max,
                sample_count: sample_count as u64,
            });
        }

        Ok(map)
    }

    pub async fn get_asset_count(&self) -> Result<i64, anyhow::Error> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM assets")
            .fetch_one(&self.pool)
            .await?;
        Ok(row.0)
    }

    pub async fn get_event_counts(&self) -> Result<EventCounts, anyhow::Error> {
        let total_row: (i64, i64, i64) = sqlx::query_as(
            "SELECT
                COALESCE(SUM(CASE WHEN event_type = 'process' THEN 1 ELSE 0 END), 0) as proc,
                COALESCE(SUM(CASE WHEN event_type = 'network' THEN 1 ELSE 0 END), 0) as net,
                COUNT(*) as total
             FROM events"
        )
        .fetch_one(&self.pool)
        .await?;

        let one_hour_ago = (Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        let hour_row: (i64, i64, i64) = sqlx::query_as(
            "SELECT
                COALESCE(SUM(CASE WHEN event_type = 'process' THEN 1 ELSE 0 END), 0) as proc,
                COALESCE(SUM(CASE WHEN event_type = 'network' THEN 1 ELSE 0 END), 0) as net,
                COUNT(*) as total
             FROM events WHERE timestamp >= ?1"
        )
        .bind(&one_hour_ago)
        .fetch_one(&self.pool)
        .await?;

        Ok(EventCounts {
            process_events: total_row.0 as u64,
            network_events: total_row.1 as u64,
            total_events: total_row.2 as u64,
            last_hour: EventCountBucket {
                process: hour_row.0 as u64,
                network: hour_row.1 as u64,
                total: hour_row.2 as u64,
            },
        })
    }

    pub async fn get_events_per_hour_24h(&self) -> Result<Vec<HourlyEvents>, anyhow::Error> {
        let since = (Utc::now() - chrono::Duration::hours(24)).to_rfc3339();
        let rows = sqlx::query(
            "SELECT
                strftime('%Y-%m-%d %H:00:00', timestamp) as hour_bucket,
                SUM(CASE WHEN event_type = 'process' THEN 1 ELSE 0 END) as proc,
                SUM(CASE WHEN event_type = 'network' THEN 1 ELSE 0 END) as net,
                COUNT(*) as total
             FROM events
             WHERE timestamp >= ?1
             GROUP BY hour_bucket
             ORDER BY hour_bucket ASC"
        )
        .bind(&since)
        .fetch_all(&self.pool)
        .await?;

        let mut result = Vec::new();
        for row in rows {
            let bucket_str: String = row.get(0);
            let proc: Option<i64> = row.get(1);
            let net: Option<i64> = row.get(2);
            let total: Option<i64> = row.get(3);
            result.push(HourlyEvents {
                hour_label: bucket_str,
                process_events: proc.unwrap_or(0) as u64,
                network_events: net.unwrap_or(0) as u64,
                total_events: total.unwrap_or(0) as u64,
            });
        }
        Ok(result)
    }

    pub async fn health_check(&self) -> Result<(), String> {
        Ok(())
    }

    // Anomaly management methods
    pub async fn insert_anomaly(&self, anomaly: &AssetAnomaly) -> Result<i64, anyhow::Error> {
        let deviations_json = serde_json::to_string(&anomaly.deviations)?;
        
        let result = sqlx::query(
            "INSERT INTO anomalies (asset_id, asset_type, display_name, severity, max_severity, overall_score, deviations_json, detected_at, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(&anomaly.asset_id)
        .bind(anomaly.asset_type.to_string())
        .bind(&anomaly.display_name)
        .bind(anomaly.max_severity.to_string())
        .bind(anomaly.max_severity.to_string())
        .bind(anomaly.overall_score)
        .bind(&deviations_json)
        .bind(anomaly.detected_at.to_rfc3339())
        .bind("Open")
        .execute(&self.pool)
        .await?;

        Ok(result.last_insert_rowid())
    }

    pub async fn get_anomalies(
        &self,
        limit: usize,
        offset: usize,
        severity_filter: Option<String>,
        status_filter: Option<String>,
    ) -> Result<Vec<AnomalyRecord>, anyhow::Error> {
        let mut query = "SELECT id, asset_id, asset_type, display_name, severity, max_severity, overall_score, deviations_json, detected_at, status, acknowledged_at, resolved_at, cooldown_until
                        FROM anomalies".to_string();
        let mut conditions = Vec::new();
        
        if let Some(severity) = &severity_filter {
            conditions.push(format!("max_severity = '{}'", severity));
        }
        if let Some(status) = &status_filter {
            conditions.push(format!("status = '{}'", status));
        }
        
        if !conditions.is_empty() {
            query.push_str(" WHERE ");
            query.push_str(&conditions.join(" AND "));
        }
        
        query.push_str(" ORDER BY detected_at DESC LIMIT ?1 OFFSET ?2");
        
        let rows = sqlx::query(&query)
            .bind(limit as i64)
            .bind(offset as i64)
            .fetch_all(&self.pool)
            .await?;

        let mut results = Vec::new();
        for row in rows {
            let id: i64 = row.get(0);
            let asset_id: String = row.get(1);
            let asset_type: String = row.get(2);
            let display_name: String = row.get(3);
            let _severity: String = row.get(4);
            let max_severity: String = row.get(5);
            let overall_score: f64 = row.get(6);
            let deviations_json: String = row.get(7);
            let detected_at_str: String = row.get(8);
            let status: String = row.get(9);
            let acknowledged_at: Option<String> = row.get(10);
            let resolved_at: Option<String> = row.get(11);
            let _cooldown_until: Option<String> = row.get(12);

            let detected_at = DateTime::parse_from_rfc3339(&detected_at_str)
                .unwrap()
                .with_timezone(&Utc);
            
            let deviations: Vec<FeatureDeviation> = serde_json::from_str(&deviations_json)?;

            results.push(AnomalyRecord {
                id,
                asset_id,
                asset_type,
                display_name,
                severity: max_severity.clone(),
                max_severity,
                overall_score,
                deviations,
                detected_at,
                status: status.parse().unwrap_or(AlertStatus::Open),
                acknowledged_at,
                resolved_at,
            });
        }

        Ok(results)
    }

    pub async fn acknowledge_anomaly(&self, id: i64) -> Result<(), anyhow::Error> {
        sqlx::query("UPDATE anomalies SET status = 'Acknowledged', acknowledged_at = ?1 WHERE id = ?2")
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn resolve_anomaly(&self, id: i64) -> Result<(), anyhow::Error> {
        sqlx::query("UPDATE anomalies SET status = 'Resolved', resolved_at = ?1 WHERE id = ?2")
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn count_open_anomalies(&self) -> Result<i64, anyhow::Error> {
        let row = sqlx::query("SELECT COUNT(*) FROM anomalies WHERE status = 'Open'")
            .fetch_one(&self.pool)
            .await?;
        Ok(row.get(0))
    }

    pub async fn get_anomaly_details(&self, id: i64) -> Result<AnomalyRecord, anyhow::Error> {
        let row = sqlx::query(
            "SELECT id, asset_id, asset_type, display_name, severity, max_severity, overall_score, deviations_json, detected_at, status, acknowledged_at, resolved_at, cooldown_until
             FROM anomalies WHERE id = ?1",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        let anomaly_id: i64 = row.get(0);
        let asset_id: String = row.get(1);
        let asset_type: String = row.get(2);
        let display_name: String = row.get(3);
        let _severity: String = row.get(4);
        let max_severity: String = row.get(5);
        let overall_score: f64 = row.get(6);
        let deviations_json: String = row.get(7);
        let detected_at_str: String = row.get(8);
        let status: String = row.get(9);
        let acknowledged_at: Option<String> = row.get(10);
        let resolved_at: Option<String> = row.get(11);
        let _cooldown_until: Option<String> = row.get(12);

        let detected_at = DateTime::parse_from_rfc3339(&detected_at_str)
            .unwrap()
            .with_timezone(&Utc);
        
        let deviations: Vec<FeatureDeviation> = serde_json::from_str(&deviations_json)?;

        Ok(AnomalyRecord {
            id: anomaly_id,
            asset_id,
            asset_type,
            display_name,
            severity: max_severity.clone(),
            max_severity,
            overall_score,
            deviations,
            detected_at,
            status: status.parse().unwrap_or(AlertStatus::Open),
            acknowledged_at,
            resolved_at,
        })
    }

    pub async fn check_cooldown(&self, asset_id: &str, feature_name: &str, severity: &str) -> bool {
        let five_minutes_ago = Utc::now() - Duration::minutes(5);
        
        let result = sqlx::query(
            "SELECT COUNT(*) FROM anomalies 
             WHERE asset_id = ?1 AND deviations_json LIKE ?2 AND max_severity = ?3 AND detected_at > ?4",
        )
        .bind(asset_id)
        .bind(format!("%\"feature_name\":\"{}\"%", feature_name))
        .bind(severity)
        .bind(five_minutes_ago.to_rfc3339())
        .fetch_one(&self.pool)
        .await;

        match result {
            Ok(row) => {
                let count: i64 = row.get(0);
                count > 0
            }
            Err(_) => false,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EventCountBucket {
    pub process: u64,
    pub network: u64,
    pub total: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EventCounts {
    pub process_events: u64,
    pub network_events: u64,
    pub total_events: u64,
    pub last_hour: EventCountBucket,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HourlyEvents {
    pub hour_label: String,
    pub process_events: u64,
    pub network_events: u64,
    pub total_events: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnomalyRecord {
    pub id: i64,
    pub asset_id: String,
    pub asset_type: String,
    pub display_name: String,
    pub severity: String,
    pub max_severity: String,
    pub overall_score: f64,
    pub deviations: Vec<FeatureDeviation>,
    pub detected_at: DateTime<Utc>,
    pub status: AlertStatus,
    pub acknowledged_at: Option<String>,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum AlertStatus {
    Open,
    Acknowledged,
    Resolved,
}

impl std::str::FromStr for AlertStatus {
    type Err = String;
    
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "Open" => Ok(AlertStatus::Open),
            "Acknowledged" => Ok(AlertStatus::Acknowledged),
            "Resolved" => Ok(AlertStatus::Resolved),
            _ => Err(format!("Unknown alert status: {}", s)),
        }
    }
}

impl std::fmt::Display for AlertStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertStatus::Open => write!(f, "Open"),
            AlertStatus::Acknowledged => write!(f, "Acknowledged"),
            AlertStatus::Resolved => write!(f, "Resolved"),
        }
    }
}