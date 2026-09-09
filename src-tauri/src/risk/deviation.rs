use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::discovery::AssetType;
use crate::fingerprint::{AssetFeatures, Baseline, BaselineStats, BaselineManager, FeatureExtractor};
use crate::events::EnrichedEvent;

// ---- IQR Stats ----
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IQRStats {
    pub q1: f64,
    pub q3: f64,
    pub median: f64,
    pub n: u64,
}

impl IQRStats {
    pub fn from_values(values: &[f64]) -> Self {
        let mut sorted = values.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let n = sorted.len();
        if n == 0 {
            return Self { q1: 0.0, q3: 0.0, median: 0.0, n: 0 };
        }
        let q1_idx = n / 4;
        let q3_idx = 3 * n / 4;
        Self {
            q1: sorted.get(q1_idx).copied().unwrap_or(sorted[0]),
            q3: sorted.get(q3_idx).copied().unwrap_or(sorted[n - 1]),
            median: sorted.get(n / 2).copied().unwrap_or(sorted[0]),
            n: n as u64,
        }
    }

    pub fn deviation_score(&self, value: f64) -> f64 {
        if self.n < 5 {
            return 0.0;
        }
        let iqr = self.q3 - self.q1;
        if iqr == 0.0 {
            return 0.0;
        }
        let iqr_score = (value - self.median).abs() / iqr;
        if iqr_score > 1.5 {
            iqr_score
        } else {
            0.0
        }
    }
}

// ---- Anomaly Severity ----
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AnomalySeverity {
    None = 0,
    Low = 1,
    Medium = 2,
    High = 3,
    Critical = 4,
}

impl AnomalySeverity {
    // REFINED: Critical at 5.0σ (was 4.0)
    pub fn from_z_score(z: f64) -> Self {
        let a = z.abs();
        if a >= 5.0 { AnomalySeverity::Critical }
        else if a >= 3.0 { AnomalySeverity::High }
        else if a >= 2.0 { AnomalySeverity::Medium }
        else if a >= 1.5 { AnomalySeverity::Low }
        else { AnomalySeverity::None }
    }

    pub fn label(&self) -> &'static str {
        match self {
            AnomalySeverity::None => "Normal",
            AnomalySeverity::Low => "Low",
            AnomalySeverity::Medium => "Medium",
            AnomalySeverity::High => "High",
            AnomalySeverity::Critical => "Critical",
        }
    }
}

impl std::fmt::Display for AnomalySeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

// ---- Feature Deviation (with confidence) ----
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureDeviation {
    pub feature_name: String,
    pub current_value: f64,
    pub baseline_mean: f64,
    pub baseline_stddev: f64,
    pub z_score: f64,
    pub iqr_score: f64,
    pub severity: AnomalySeverity,
    pub confidence: f64, // 0.0–1.0 based on sample count
}

// ---- Asset Anomaly ----
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetAnomaly {
    pub asset_id: String,
    pub asset_type: AssetType,
    pub display_name: String,
    pub overall_score: f64,
    pub max_severity: AnomalySeverity,
    pub deviations: Vec<FeatureDeviation>,
    pub detected_at: DateTime<Utc>,
    pub window_start: DateTime<Utc>,
    pub window_end: DateTime<Utc>,
    pub event_count: u64,
    pub confidence: f64, // overall confidence for this anomaly
}

// ---- Anomaly Detector (REFINED) ----
pub struct AnomalyDetector {
    pub z_threshold: f64,
    pub min_samples: u64,      // NOW 50
    pub critical_threshold: f64, // NOW 5.0
}

impl AnomalyDetector {
    pub fn new() -> Self {
        Self {
            z_threshold: 2.0,
            min_samples: 50,        // REFINED: was 3
            critical_threshold: 5.0, // REFINED: was 4.0
        }
    }

    pub fn with_threshold(z_threshold: f64) -> Self {
        Self {
            z_threshold,
            min_samples: 50,
            critical_threshold: 5.0,
        }
    }

    pub fn deviation_for_feature(
        &self,
        feature_name: &str,
        current_value: f64,
        baseline: Option<&BaselineStats>,
        iqr_score: f64,
    ) -> Option<FeatureDeviation> {
        let bl = baseline?;
        if bl.sample_count < self.min_samples {
            return None;
        }
        let z_score = bl.z_score(current_value);
        let mut severity = AnomalySeverity::from_z_score(z_score);

        // Override severity based on critical_threshold
        if z_score.abs() >= self.critical_threshold {
            severity = AnomalySeverity::Critical;
        }

        // Confidence based on sample count: more samples = higher confidence
        let confidence = (bl.sample_count as f64 / (bl.sample_count as f64 + 20.0)).clamp(0.1, 0.95);

        // If z_score is low and IQR is low, skip
        if z_score.abs() < 1.0 && iqr_score < 0.5 {
            return None;
        }

        Some(FeatureDeviation {
            feature_name: feature_name.to_string(),
            current_value,
            baseline_mean: bl.mean,
            baseline_stddev: bl.stddev,
            z_score,
            iqr_score,
            severity,
            confidence,
        })
    }

    pub fn detect_for_asset(
        &self,
        features: &AssetFeatures,
        baseline: Option<&Baseline>,
        iqr_stats: Option<&HashMap<String, IQRStats>>,
    ) -> Option<AssetAnomaly> {
        let mut deviations = Vec::new();
        let bl_stats = baseline.map(|b| &b.stats);
        // FIX (E0716): HashMap::new() was a temporary being borrowed past its
        // lifetime. Bind it to a named variable first so the reference is valid.
        let empty_map = HashMap::new();
        let iqr_map = iqr_stats.unwrap_or(&empty_map);

        let feature_map: [(&str, f64); 8] = [
            ("event_count", features.event_count as f64),
            ("connection_rate", features.connection_rate),
            ("unique_destinations", features.unique_destinations as f64),
            ("unique_ports", features.unique_ports as f64),
            ("process_cpu_avg", features.process_cpu_avg),
            ("process_cpu_max", features.process_cpu_max),
            ("process_mem_avg", features.process_mem_avg),
            ("process_mem_max", features.process_mem_max as f64),
        ];

        for (name, value) in feature_map.iter() {
            let stat = bl_stats.and_then(|s| s.get(*name));
            let iqr = iqr_map.get(*name).map(|iq| iq.deviation_score(*value)).unwrap_or(0.0);
            if let Some(d) = self.deviation_for_feature(name, *value, stat, iqr) {
                if d.severity != AnomalySeverity::None {
                    deviations.push(d);
                }
            }
        }

        if deviations.is_empty() {
            return None;
        }

        let max_severity = deviations.iter()
            .map(|d| d.severity)
            .max()
            .unwrap_or(AnomalySeverity::None);

        let overall_score = deviations.iter()
            .map(|d| d.z_score.abs() * 0.6 + d.iqr_score * 0.4)
            .sum::<f64>();

        let confidence = if deviations.is_empty() {
            0.0
        } else {
            deviations.iter().map(|d| d.confidence).sum::<f64>() / deviations.len() as f64
        };

        let display_name = make_display_name(&features.asset_id, features.asset_type);

        // Only return if confidence is above 0.2 and severity is not None
        if confidence < 0.2 || max_severity == AnomalySeverity::None {
            return None;
        }

        Some(AssetAnomaly {
            asset_id: features.asset_id.clone(),
            asset_type: features.asset_type,
            display_name,
            overall_score,
            max_severity,
            deviations,
            detected_at: Utc::now(),
            window_start: features.window_start,
            window_end: features.window_end,
            event_count: features.event_count,
            confidence,
        })
    }

    pub fn detect_all(
        &self,
        features: &HashMap<String, AssetFeatures>,
        baselines: &HashMap<String, Baseline>,
        iqr_stats: &HashMap<String, HashMap<String, IQRStats>>,
    ) -> Vec<AssetAnomaly> {
        let mut results = Vec::new();
        for (asset_id, f) in features {
            let bl = baselines.get(asset_id);
            let iqr = iqr_stats.get(asset_id);
            if let Some(anomaly) = self.detect_for_asset(f, bl, iqr) {
                results.push(anomaly);
            }
        }
        results.sort_by(|a, b| {
            b.max_severity.cmp(&a.max_severity)
                .then_with(|| b.overall_score.partial_cmp(&a.overall_score).unwrap_or(std::cmp::Ordering::Equal))
        });
        results
    }
}

impl Default for AnomalyDetector {
    fn default() -> Self { Self::new() }
}

// ---- Helper functions ----
fn make_display_name(asset_id: &str, asset_type: AssetType) -> String {
    match asset_type {
        AssetType::NetworkEndpoint => {
            asset_id.strip_prefix("net:").unwrap_or(asset_id).to_string()
        }
        AssetType::Process => {
            let stripped = asset_id.strip_prefix("proc:").unwrap_or(asset_id);
            stripped.rsplitn(2, ':').nth(1).unwrap_or(stripped).to_string()
        }
        AssetType::Device => asset_id.to_string(),
    }
}

// ---- Public pipeline entry ----
pub fn run_detection_pipeline(
    recent_events: &[EnrichedEvent],
    baseline_manager: &BaselineManager,
) -> (HashMap<String, AssetFeatures>, Vec<AssetAnomaly>) {
    let extractor = FeatureExtractor::new();
    let features = extractor.extract_per_asset(recent_events);

    let baselines_hash: HashMap<String, Baseline> = baseline_manager
        .all_baselines()
        .iter()
        .map(|b| (b.asset_id.clone(), (*b).clone()))
        .collect();

    // Build IQR stats per asset from current feature values
    let mut iqr_stats: HashMap<String, HashMap<String, IQRStats>> = HashMap::new();
    let feature_names = ["event_count", "connection_rate", "unique_destinations", "unique_ports",
                         "process_cpu_avg", "process_cpu_max", "process_mem_avg", "process_mem_max"];

    for (asset_id, feat) in &features {
        let values: Vec<f64> = feature_names.iter().map(|&name| {
            match name {
                "event_count" => feat.event_count as f64,
                "connection_rate" => feat.connection_rate,
                "unique_destinations" => feat.unique_destinations as f64,
                "unique_ports" => feat.unique_ports as f64,
                "process_cpu_avg" => feat.process_cpu_avg,
                "process_cpu_max" => feat.process_cpu_max,
                "process_mem_avg" => feat.process_mem_avg,
                "process_mem_max" => feat.process_mem_max as f64,
                _ => 0.0,
            }
        }).collect();

        // TODO: This currently computes IQRStats over the *current snapshot's*
        // 8 feature values (mixing CPU%, byte counts, port counts, etc. into one
        // distribution) and assigns the SAME IQRStats to every feature name.
        // That means IQR-based deviation scoring is not meaningful yet — it's
        // not drawing on each feature's own value *over time*. To fix properly,
        // each feature needs its own historical series (e.g. from
        // BaselineManager) fed into IQRStats::from_values() separately.
        // Left as-is (matches prior behavior) pending that data being available.
        let mut map = HashMap::new();
        for name in feature_names.iter() {
            let feat_iqr = IQRStats::from_values(&values);
            map.insert(name.to_string(), feat_iqr);
        }
        iqr_stats.insert(asset_id.clone(), map);
    }

    let detector = AnomalyDetector::new();
    let anomalies = detector.detect_all(&features, &baselines_hash, &iqr_stats);
    (features, anomalies)
}

pub fn format_anomaly_summary(a: &AssetAnomaly) -> String {
    let top = a.deviations.iter().max_by(|x, y| {
        x.z_score.abs().partial_cmp(&y.z_score.abs()).unwrap_or(std::cmp::Ordering::Equal)
    });
    let top_str = top.map(|d| format!(
        "{}={:.1} (μ={:.1}, σ={:.1}, z={:+.2}, conf={:.2})",
        d.feature_name, d.current_value, d.baseline_mean, d.baseline_stddev, d.z_score, d.confidence
    )).unwrap_or_default();
    format!("[{}] {} {} — score={:.2} (conf={:.2}) | {}",
        a.max_severity.label(),
        match a.asset_type {
            AssetType::NetworkEndpoint => "NET",
            AssetType::Process => "PROC",
            AssetType::Device => "DEV",
        },
        a.display_name,
        a.overall_score,
        a.confidence,
        top_str
    )
}