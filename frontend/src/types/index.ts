export type EventStatus = 'Info' | 'Warning' | 'Critical' | 'Resolved' | 'Network' | 'Anomaly';

export type SecurityEvent =
  | { Process: ProcessEvent }
  | { Network: NetworkEvent };

export interface EnrichedEvent {
  id?: number;
  timestamp: string;
  source: string;
  asset_id?: string;
  event: SecurityEvent;
  status?: EventStatus;
  details?: string;
}

export interface ProcessEvent {
  pid: number;
  name: string;
  parent_pid?: number;
  cpu_usage: number;
  memory_usage: number;
}

export interface NetworkEvent {
  local_ip: string;
  local_port: number;
  remote_ip: string;
  remote_port: number;
  protocol: string;
}

export interface StatCard {
  label: string;
  value: number;
  trend: 'up' | 'down' | 'neutral';
  trendValue?: number;
}

export type AssetType = 'NetworkEndpoint' | 'Process' | 'Device';

export type AnomalySeverity = 'None' | 'Low' | 'Medium' | 'High' | 'Critical';

export interface FeatureDeviation {
  feature_name: string;
  current_value: number;
  baseline_mean: number;
  baseline_stddev: number;
  z_score: number;
  severity: AnomalySeverity;
}

export interface AssetAnomaly {
  asset_id: string;
  asset_type: AssetType;
  display_name: string;
  overall_score: number;
  max_severity: AnomalySeverity;
  deviations: FeatureDeviation[];
  detected_at: string;
  window_start: string;
  window_end: string;
  event_count: number;
}

export interface EventCounts {
  process_events: number;
  network_events: number;
  total_events: number;
  last_hour: {
    process: number;
    network: number;
    total: number;
  };
}

export type Trend = 'up' | 'down' | 'neutral';

export interface HourlyEvents {
  hour_label: string;
  process_events: number;
  network_events: number;
  total_events: number;
}

export type AlertStatus = 'Open' | 'Acknowledged' | 'Resolved';

export interface AnomalyRecord {
  id: number;
  asset_id: string;
  asset_type: string;
  display_name: string;
  severity: string;
  max_severity: string;
  overall_score: number;
  deviations: FeatureDeviation[];
  detected_at: string;
  status: AlertStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
}
