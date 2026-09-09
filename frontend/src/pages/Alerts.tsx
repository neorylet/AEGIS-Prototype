import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  RefreshCw,
  Cpu,
  Radio,
  Search,
  ChevronDown,
  CheckCircle,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { commands } from '../services/tauri';
import { AnomalyRecord, AnomalySeverity } from '../types';

/**
 * Severity badge styling matching Dashboard.tsx
 */
export const severityBadgeClass = (s: AnomalySeverity | string): string => {
  switch (s) {
    case 'Critical':
      return 'bg-rose-600 text-white shadow-xs font-semibold';
    case 'High':
      return 'bg-amber-600 text-white shadow-xs font-semibold';
    case 'Medium':
      return 'bg-orange-600 text-white shadow-xs font-semibold';
    case 'Low':
    default:
      return 'bg-slate-700 text-white font-medium';
  }
};

/**
 * Formats ISO timestamp to human-friendly local string
 */
export const formatTimestamp = (ts: string): string => {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
};

/**
 * Formats relative time for high-level event recency
 */
const formatRelativeTime = (ts: string): string => {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (isNaN(diffMs)) return ts;

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  } catch {
    return ts;
  }
};

const formatAssetLabel = (a: AnomalyRecord): string => {
  if (a.asset_type === 'Process') return `${a.display_name} (Process)`;
  return a.display_name;
};

type AlertStatus = 'Open' | 'Acknowledged' | 'Resolved';

export const Alerts = () => {
  const [alerts, setAlerts] = useState<AnomalyRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [limit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [openCount, setOpenCount] = useState<number>(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSeverity, setSelectedSeverity] = useState<'all' | 'Critical' | 'High' | 'Medium' | 'Low'>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | AlertStatus>('all');

  // Load initial / filtered alerts
  const loadAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const severityFilter = selectedSeverity === 'all' ? undefined : selectedSeverity;
      const statusFilter = selectedStatus === 'all' ? undefined : selectedStatus;
      const fetched = await commands.getAlerts(limit, 0, severityFilter, statusFilter);
      setAlerts(fetched);
      setOffset(0);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    } finally {
      setLoading(false);
    }
  }, [limit, selectedSeverity, selectedStatus]);

  // Load more alerts (pagination)
  const handleLoadMore = async () => {
    try {
      setLoading(true);
      const nextOffset = offset + limit;
      const severityFilter = selectedSeverity === 'all' ? undefined : selectedSeverity;
      const statusFilter = selectedStatus === 'all' ? undefined : selectedStatus;
      const fetched = await commands.getAlerts(limit, nextOffset, severityFilter, statusFilter);
      setAlerts((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const uniqueFetched = fetched.filter((a) => !existingIds.has(a.id));
        return [...prev, ...uniqueFetched];
      });
      setOffset(nextOffset);
    } catch (error) {
      console.error('Failed to load more alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadOpenCount = useCallback(async () => {
    try {
      const count = await commands.countOpenAlerts();
      setOpenCount(count);
    } catch (error) {
      console.error('Failed to load open count:', error);
    }
  }, []);

  const handleAcknowledge = async (alertId: number) => {
    try {
      await commands.acknowledgeAlert(alertId);
      await loadAlerts();
      await loadOpenCount();
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
    }
  };

  const handleResolve = async (alertId: number) => {
    try {
      await commands.resolveAlert(alertId);
      await loadAlerts();
      await loadOpenCount();
    } catch (error) {
      console.error('Failed to resolve alert:', error);
    }
  };

  const handleBulkAcknowledge = async () => {
    for (const id of selectedIds) {
      await handleAcknowledge(id);
    }
    setSelectedIds(new Set());
  };

  const handleBulkResolve = async () => {
    for (const id of selectedIds) {
      await handleResolve(id);
    }
    setSelectedIds(new Set());
  };

  const toggleExpand = (alertId: number) => {
    setExpandedId((prev) => (prev === alertId ? null : alertId));
  };

  const toggleSelect = (alertId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(alertId)) {
        next.delete(alertId);
      } else {
        next.add(alertId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAlerts.length && filteredAlerts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAlerts.map((a) => a.id)));
    }
  };

  // Load alerts on mount and when filter criteria change
  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // Load open count periodically
  useEffect(() => {
    loadOpenCount();
    const interval = setInterval(loadOpenCount, 10000);
    return () => clearInterval(interval);
  }, [loadOpenCount]);

  // Auto-refresh alerts every 10s
  useEffect(() => {
    const interval = setInterval(loadAlerts, 10000);
    return () => clearInterval(interval);
  }, [loadAlerts]);

  // Listen for real-time anomaly events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen('new-anomaly', () => {
        loadAlerts();
        loadOpenCount();
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadAlerts, loadOpenCount]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase();
      return (
        a.display_name.toLowerCase().includes(q) ||
        a.asset_type.toLowerCase().includes(q) ||
        String(a.overall_score).includes(q)
      );
    });
  }, [alerts, searchQuery]);

  // Status indicator colors: Open = Yellow, Acknowledged = Blue, Resolved = Green
  const getStatusDot = (status: AlertStatus): string => {
    switch (status) {
      case 'Open':
        return 'bg-yellow-500';
      case 'Acknowledged':
        return 'bg-blue-500';
      case 'Resolved':
        return 'bg-emerald-500';
      default:
        return 'bg-slate-400';
    }
  };

  const getConfidenceColor = (score: number): string => {
    if (score >= 8) return 'bg-rose-500';
    if (score >= 6) return 'bg-amber-500';
    if (score >= 4) return 'bg-orange-500';
    return 'bg-slate-400 dark:bg-slate-500';
  };

  return (
    <div className="space-y-6">
      {/* Top Toolbar */}
      <div className="aegis-card p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Anomaly Alerts
            </h3>
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              ({filteredAlerts.length} displayed)
            </span>
            {openCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                {openCount} open
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search asset, process, score..."
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 w-44 sm:w-56"
              />
            </div>

            {/* Severity Filter Dropdown */}
            <div className="relative">
              <select
                value={selectedSeverity}
                onChange={(e) => {
                  setSelectedSeverity(e.target.value as any);
                  setOffset(0);
                }}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
                className="text-xs rounded-lg border pl-2.5 pr-7 py-1.5 appearance-none focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium cursor-pointer"
              >
                <option value="all">All Severities</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Status Filter Dropdown */}
            <div className="relative">
              <select
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value as any);
                  setOffset(0);
                }}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
                className="text-xs rounded-lg border pl-2.5 pr-7 py-1.5 appearance-none focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="Open">Open</option>
                <option value="Acknowledged">Acknowledged</option>
                <option value="Resolved">Resolved</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => loadAlerts()}
              disabled={loading}
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border)',
                color: 'var(--text-secondary)',
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            {/* Bulk Actions */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBulkAcknowledge}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Acknowledge Selected ({selectedIds.size})</span>
                </button>
                <button
                  onClick={handleBulkResolve}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Resolve Selected ({selectedIds.size})</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Alerts Table Card */}
      <div className="aegis-card overflow-hidden">
        {/* Loading Skeleton */}
        {loading && alerts.length === 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-muted)',
                }}
                className="sticky top-0 border-b text-[11px] font-semibold uppercase tracking-wider select-none"
              >
                <tr>
                  <th className="px-4 py-3 w-10">
                    <div className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                  </th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...Array(6)].map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="px-4 py-3.5">
                      <div className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-700" />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="w-20 h-4 rounded bg-slate-200 dark:bg-slate-700" />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded bg-slate-200 dark:bg-slate-700 shrink-0" />
                        <div className="w-32 h-4 rounded bg-slate-200 dark:bg-slate-700" />
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="w-16 h-5 rounded-full bg-slate-200 dark:bg-slate-700" />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-4 rounded bg-slate-200 dark:bg-slate-700" />
                        <div className="w-16 h-2 rounded bg-slate-200 dark:bg-slate-700" />
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="w-24 h-4 rounded bg-slate-200 dark:bg-slate-700" />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="w-16 h-5 rounded bg-slate-200 dark:bg-slate-700" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : filteredAlerts.length === 0 ? (
          /* Empty State */
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <div
              style={{
                backgroundColor: 'var(--bg-app)',
                borderColor: 'var(--border)',
              }}
              className="mb-4 w-14 h-14 rounded-full flex items-center justify-center border shadow-xs text-emerald-500"
            >
              <ShieldCheck className="w-7 h-7" />
            </div>
            <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              No alerts detected
            </h4>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              System behavior is within normal baseline parameters.
            </p>
          </div>
        ) : (
          /* Table Content */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-muted)',
                }}
                className="sticky top-0 border-b text-[11px] font-semibold uppercase tracking-wider select-none"
              >
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredAlerts.length && filteredAlerts.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody
                style={{ borderColor: 'var(--border)' }}
                className="divide-y divide-slate-100 dark:divide-slate-800 text-xs"
              >
                {filteredAlerts.map((alert) => {
                  const isExpanded = expandedId === alert.id;
                  const isSelected = selectedIds.has(alert.id);

                  return (
                    <React.Fragment key={alert.id}>
                      <tr
                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer ${
                          isExpanded ? 'bg-slate-50/50 dark:bg-slate-800/20' : ''
                        }`}
                        onClick={() => toggleExpand(alert.id)}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(alert.id)}
                            className="w-4 h-4 rounded cursor-pointer"
                          />
                        </td>

                        {/* Timestamp */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="font-mono text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                              {formatRelativeTime(alert.detected_at)}
                            </span>
                            <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                              {formatTimestamp(alert.detected_at)}
                            </span>
                          </div>
                        </td>

                        {/* Asset */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <span
                              style={{
                                backgroundColor: 'var(--bg-app)',
                                borderColor: 'var(--border)',
                                color: 'var(--text-secondary)',
                              }}
                              className="w-7 h-7 rounded-lg flex items-center justify-center border shrink-0 shadow-2xs"
                            >
                              {alert.asset_type === 'Process' ? (
                                <Cpu className="w-3.5 h-3.5 text-sky-500" />
                              ) : (
                                <Radio className="w-3.5 h-3.5 text-violet-500" />
                              )}
                            </span>
                            <div className="flex flex-col">
                              <span className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>
                                {formatAssetLabel(alert)}
                              </span>
                              <span className="text-[10px] capitalize" style={{ color: 'var(--text-muted)' }}>
                                {alert.asset_type}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Severity Badge */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] uppercase tracking-wide ${severityBadgeClass(
                              alert.max_severity as AnomalySeverity
                            )}`}
                          >
                            {alert.max_severity}
                          </span>
                        </td>

                        {/* Score & Progress */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
                              {alert.overall_score.toFixed(1)}
                            </span>
                            <div className="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700/80 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${getConfidenceColor(
                                  alert.overall_score
                                )}`}
                                style={{ width: `${Math.min(alert.overall_score * 10, 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${getStatusDot(alert.status)}`} />
                            <span className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>
                              {alert.status}
                            </span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {alert.status === 'Open' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAcknowledge(alert.id);
                                }}
                                className="px-2 py-1 rounded text-xs font-medium bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-colors flex items-center gap-1"
                                title="Acknowledge alert"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span>Acknowledge</span>
                              </button>
                            )}
                            {alert.status !== 'Resolved' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResolve(alert.id);
                                }}
                                className="px-2 py-1 rounded text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors flex items-center gap-1"
                                title="Resolve alert"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Resolve</span>
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(alert.id);
                              }}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              title={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              <ChevronDown
                                className={`w-4 h-4 transition-transform duration-200 ${
                                  isExpanded ? 'rotate-180 text-sky-500' : ''
                                }`}
                              />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Deviation Cards */}
                      {isExpanded && (
                        <tr className="bg-slate-50/70 dark:bg-slate-900/40">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                                    Detected Feature Deviations
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                    {alert.deviations.length} {alert.deviations.length === 1 ? 'feature' : 'features'}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                  Overall Score: <span className="font-bold text-slate-800 dark:text-slate-100">{alert.overall_score.toFixed(2)}</span>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                {alert.deviations.map((dev, idx) => {
                                  const isPositiveZ = dev.z_score >= 0;
                                  return (
                                    <div
                                      key={idx}
                                      className="p-3.5 rounded-lg border bg-white dark:bg-slate-800/90 border-slate-200 dark:border-slate-700/60 shadow-xs space-y-2.5"
                                    >
                                      {/* Feature Name & Severity */}
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate" title={dev.feature_name}>
                                          {dev.feature_name}
                                        </span>
                                        <span
                                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${severityBadgeClass(
                                            dev.severity as AnomalySeverity
                                          )}`}
                                        >
                                          {dev.severity}
                                        </span>
                                      </div>

                                      {/* Current Value */}
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="text-slate-500 dark:text-slate-400">Current Value:</span>
                                        <span className="font-mono font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800/60">
                                          {dev.current_value.toFixed(2)}
                                        </span>
                                      </div>

                                      {/* Baseline Mean & Stddev */}
                                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-700/40">
                                        <span className="text-[11px]">Baseline:</span>
                                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                          μ = {dev.baseline_mean.toFixed(2)}, σ = {dev.baseline_stddev.toFixed(2)}
                                        </span>
                                      </div>

                                      {/* Z-Score with color coding */}
                                      <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-700/40">
                                        <span className="text-slate-500 dark:text-slate-400 text-[11px]">Z-Score:</span>
                                        <span
                                          className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                                            isPositiveZ
                                              ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60'
                                              : 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60'
                                          }`}
                                        >
                                          {isPositiveZ ? `+${dev.z_score.toFixed(2)}` : dev.z_score.toFixed(2)}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Load More Button */}
        {alerts.length >= limit && (
          <div
            style={{
              borderTopColor: 'var(--border)',
              backgroundColor: 'var(--bg-subtle)',
            }}
            className="p-4 border-t flex justify-center"
          >
            <button
              onClick={handleLoadMore}
              disabled={loading}
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
              className="px-4 py-2 rounded-lg text-xs font-medium border hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors disabled:opacity-50 shadow-2xs"
            >
              <ChevronDown className={`w-4 h-4 ${loading ? 'animate-bounce' : ''}`} />
              <span>{loading ? 'Loading...' : 'Load More Alerts'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};