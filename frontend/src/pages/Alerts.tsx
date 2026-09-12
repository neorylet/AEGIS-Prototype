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
  AlertTriangle,
  Flame,
  AlertCircle,
  Info,
  SlidersHorizontal,
} from 'lucide-react';
import { commands } from '../services/tauri';
import { AnomalyRecord, AnomalySeverity } from '../types';

/**
 * Severity badge styling matching Dashboard.tsx with refined soft-tint support
 */
export const severityBadgeClass = (s: AnomalySeverity | string): string => {
  switch (s) {
    case 'Critical':
      return 'bg-rose-500/15 text-rose-500 dark:text-rose-400 border border-rose-500/30 font-semibold';
    case 'High':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold';
    case 'Medium':
      return 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30 font-medium';
    case 'Low':
    default:
      return 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/25 font-medium';
  }
};

/**
 * Severity accent border for instant vertical row scanning (Datadog style)
 */
const getSeverityBorderAccent = (s: AnomalySeverity | string): string => {
  switch (s) {
    case 'Critical':
      return 'border-l-rose-500';
    case 'High':
      return 'border-l-amber-500';
    case 'Medium':
      return 'border-l-orange-500';
    case 'Low':
    default:
      return 'border-l-slate-400 dark:border-l-slate-600';
  }
};

/**
 * Fix 1: Score bar color strictly matches the alert severity
 */
const getScoreBarColor = (s: AnomalySeverity | string): string => {
  switch (s) {
    case 'Critical':
      return 'bg-rose-500';
    case 'High':
      return 'bg-amber-500';
    case 'Medium':
      return 'bg-orange-500';
    case 'Low':
    default:
      return 'bg-slate-500 dark:bg-slate-600';
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
export const formatRelativeTime = (ts: string): string => {
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

/**
 * Fix 3: Classifies alert timestamp into standard chronological buckets
 */
export const getTimeBucket = (iso: string): string => {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (isNaN(diffMs)) return 'Earlier';

    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Last minute';
    if (diffSec < 300) return 'Last 5 minutes';
    if (diffSec < 900) return 'Last 15 minutes';
    if (diffSec < 3600) return 'Last hour';

    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (isToday) return 'Today';

    return 'Earlier';
  } catch {
    return 'Earlier';
  }
};

/**
 * Clean asset title without duplicate type suffixes
 */
const formatAssetLabel = (a: AnomalyRecord): string => {
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

  // Fix 3: Group filtered alerts into ordered chronological buckets
  const groupedAlerts = useMemo(() => {
    const bucketOrder = [
      'Last minute',
      'Last 5 minutes',
      'Last 15 minutes',
      'Last hour',
      'Today',
      'Earlier',
    ];
    const groups: Record<string, AnomalyRecord[]> = {};

    for (const alert of filteredAlerts) {
      const bucket = getTimeBucket(alert.detected_at);
      if (!groups[bucket]) {
        groups[bucket] = [];
      }
      groups[bucket].push(alert);
    }

    return bucketOrder
      .filter((b) => groups[b] && groups[b].length > 0)
      .map((b) => ({
        bucketName: b,
        alerts: groups[b],
      }));
  }, [filteredAlerts]);

  // Severity counts for summary stats
  const severityCounts = useMemo(() => {
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    alerts.forEach((a) => {
      if (counts[a.max_severity as keyof typeof counts] !== undefined) {
        counts[a.max_severity as keyof typeof counts]++;
      }
    });
    return counts;
  }, [alerts]);

  // Status badge styling
  const renderStatusBadge = (status: AlertStatus) => {
    switch (status) {
      case 'Open':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Open
          </span>
        );
      case 'Acknowledged':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
            Acked
          </span>
        );
      case 'Resolved':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Resolved
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/10 text-slate-500 border border-slate-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Severity Summary Bar (Datadog / Wiz style) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setSelectedSeverity(selectedSeverity === 'Critical' ? 'all' : 'Critical')}
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          className={`p-3 rounded-xl border flex items-center justify-between text-left transition-all ${
            selectedSeverity === 'Critical'
              ? 'ring-2 ring-rose-500 border-rose-500/50 bg-rose-500/5'
              : 'hover:border-slate-400 dark:hover:border-slate-600'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 shrink-0">
              <Flame className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Critical</div>
              <div className="text-base font-bold font-mono text-rose-600 dark:text-rose-400">{severityCounts.Critical}</div>
            </div>
          </div>
          {selectedSeverity === 'Critical' && <span className="text-[10px] font-medium text-rose-500 uppercase">Filtered</span>}
        </button>

        <button
          onClick={() => setSelectedSeverity(selectedSeverity === 'High' ? 'all' : 'High')}
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          className={`p-3 rounded-xl border flex items-center justify-between text-left transition-all ${
            selectedSeverity === 'High'
              ? 'ring-2 ring-amber-500 border-amber-500/50 bg-amber-500/5'
              : 'hover:border-slate-400 dark:hover:border-slate-600'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">High</div>
              <div className="text-base font-bold font-mono text-amber-600 dark:text-amber-400">{severityCounts.High}</div>
            </div>
          </div>
          {selectedSeverity === 'High' && <span className="text-[10px] font-medium text-amber-500 uppercase">Filtered</span>}
        </button>

        <button
          onClick={() => setSelectedSeverity(selectedSeverity === 'Medium' ? 'all' : 'Medium')}
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          className={`p-3 rounded-xl border flex items-center justify-between text-left transition-all ${
            selectedSeverity === 'Medium'
              ? 'ring-2 ring-orange-500 border-orange-500/50 bg-orange-500/5'
              : 'hover:border-slate-400 dark:hover:border-slate-600'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-500 shrink-0">
              <AlertCircle className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Medium</div>
              <div className="text-base font-bold font-mono text-orange-600 dark:text-orange-400">{severityCounts.Medium}</div>
            </div>
          </div>
          {selectedSeverity === 'Medium' && <span className="text-[10px] font-medium text-orange-500 uppercase">Filtered</span>}
        </button>

        <button
          onClick={() => setSelectedSeverity(selectedSeverity === 'Low' ? 'all' : 'Low')}
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          className={`p-3 rounded-xl border flex items-center justify-between text-left transition-all ${
            selectedSeverity === 'Low'
              ? 'ring-2 ring-sky-500 border-sky-500/50 bg-sky-500/5'
              : 'hover:border-slate-400 dark:hover:border-slate-600'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-slate-500/10 border border-slate-500/20 flex items-center justify-center text-slate-500 shrink-0">
              <Info className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Low</div>
              <div className="text-base font-bold font-mono text-slate-600 dark:text-slate-400">{severityCounts.Low}</div>
            </div>
          </div>
          {selectedSeverity === 'Low' && <span className="text-[10px] font-medium text-sky-500 uppercase">Filtered</span>}
        </button>
      </div>

      {/* Main Toolbar */}
      <div className="aegis-card p-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Left Title & Status Counts */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-sky-500" />
              <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Anomaly Alerts
              </h3>
            </div>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60">
              {filteredAlerts.length} loaded
            </span>
            {openCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                {openCount} open
              </span>
            )}
          </div>

          {/* Right Filters, Search & Bulk Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter asset, process, score..."
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 w-44 sm:w-52 transition-shadow"
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
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Refresh alerts"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-500' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Floating / Contextual Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-400 font-mono font-bold">
                {selectedIds.size}
              </span>
              <span>alert{selectedIds.size > 1 ? 's' : ''} selected</span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="ml-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkAcknowledge}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Acknowledge Selected</span>
              </button>
              <button
                onClick={handleBulkResolve}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Resolve Selected</span>
              </button>
            </div>
          </div>
        )}
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
                  <th className="px-4 py-3 text-right">Actions</th>
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
              className="mb-4 w-14 h-14 rounded-2xl flex items-center justify-center border shadow-xs text-emerald-500 bg-emerald-500/5 border-emerald-500/20"
            >
              <ShieldCheck className="w-7 h-7" />
            </div>
            <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              No alerts matching criteria
            </h4>
            <p className="text-xs max-w-sm" style={{ color: 'var(--text-muted)' }}>
              System telemetry is within expected baseline bounds. Adjust active filters or search terms to inspect past records.
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
                className="sticky top-0 border-b text-[11px] font-semibold uppercase tracking-wider select-none z-20"
              >
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredAlerts.length && filteredAlerts.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500 cursor-pointer"
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
                className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs"
              >
                {/* Fix 3: Render grouped rows with sticky sub-headers */}
                {groupedAlerts.map(({ bucketName, alerts: bucketAlerts }) => (
                  <React.Fragment key={bucketName}>
                    {/* Sticky Sub-header Row */}
                    <tr className="bg-slate-100 dark:bg-slate-800/60 sticky top-0 z-10">
                      <td colSpan={7} className="px-4 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                        {bucketName} · {bucketAlerts.length} alerts
                      </td>
                    </tr>

                    {/* Alert Rows in this bucket */}
                    {bucketAlerts.map((alert) => {
                      const isExpanded = expandedId === alert.id;
                      const isSelected = selectedIds.has(alert.id);

                      return (
                        <React.Fragment key={alert.id}>
                          <tr
                            className={`group border-l-[3px] transition-colors cursor-pointer ${getSeverityBorderAccent(
                              alert.max_severity
                            )} ${
                              isSelected
                                ? 'bg-sky-500/10 dark:bg-sky-500/15'
                                : isExpanded
                                ? 'bg-slate-100/60 dark:bg-slate-800/50'
                                : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                            }`}
                            onClick={() => toggleExpand(alert.id)}
                          >
                            {/* Checkbox */}
                            <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(alert.id)}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500 cursor-pointer"
                              />
                            </td>

                            {/* Timestamp (Relative on top, exact muted on bottom) */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
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
                                <div className="flex flex-col min-w-0">
                                  <span
                                    className="font-mono font-semibold text-xs truncate max-w-[200px] sm:max-w-[260px]"
                                    style={{ color: 'var(--text-primary)' }}
                                    title={formatAssetLabel(alert)}
                                  >
                                    {formatAssetLabel(alert)}
                                  </span>
                                  <span className="text-[10px] uppercase font-mono tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                    {alert.asset_type}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Severity Badge */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-semibold ${severityBadgeClass(
                                  alert.max_severity as AnomalySeverity
                                )}`}
                              >
                                {alert.max_severity}
                              </span>
                            </td>

                            {/* Fix 1: Score bar color strictly matches the alert's severity */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <div className="flex items-center gap-2.5">
                                <span className="text-xs font-bold font-mono tabular-nums w-7" style={{ color: 'var(--text-primary)' }}>
                                  {alert.overall_score.toFixed(1)}
                                </span>
                                <div className="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700/80 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${getScoreBarColor(
                                      alert.max_severity
                                    )}`}
                                    style={{ width: `${Math.min(alert.overall_score * 10, 100)}%` }}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* Status */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              {renderStatusBadge(alert.status)}
                            </td>

                            {/* Fix 2: Actions container hidden until hover on md+, chevron always visible */}
                            <td className="px-4 py-3.5 whitespace-nowrap text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
                                  {alert.status === 'Open' && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleAcknowledge(alert.id);
                                      }}
                                      className="px-2 py-1 rounded-md text-xs font-medium bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-colors flex items-center gap-1 shadow-2xs"
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
                                      className="px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors flex items-center gap-1 shadow-2xs"
                                      title="Resolve alert"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>Resolve</span>
                                    </button>
                                  )}
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleExpand(alert.id);
                                  }}
                                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                  title={isExpanded ? 'Collapse deviations' : 'Expand deviations'}
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

                          {/* Expanded Deviation Drawer */}
                          {isExpanded && (
                            <tr className="bg-slate-50/70 dark:bg-slate-900/60 border-l-[3px] border-l-sky-500">
                              <td colSpan={7} className="px-6 py-4">
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                                        Detected Feature Deviations
                                      </span>
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                        {alert.deviations.length} {alert.deviations.length === 1 ? 'feature' : 'features'}
                                      </span>
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                      Overall Score: <span className="font-bold text-slate-900 dark:text-slate-100">{alert.overall_score.toFixed(2)}</span>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {alert.deviations.map((dev, idx) => {
                                      const isPositiveZ = dev.z_score >= 0;
                                      return (
                                        <div
                                          key={idx}
                                          className="p-3.5 rounded-xl border bg-white dark:bg-slate-800/90 border-slate-200 dark:border-slate-700/60 shadow-xs space-y-2.5 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                                        >
                                          {/* Feature Name & Severity */}
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-100 truncate" title={dev.feature_name}>
                                              {dev.feature_name}
                                            </span>
                                            <span
                                              className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${severityBadgeClass(
                                                dev.severity as AnomalySeverity
                                              )}`}
                                            >
                                              {dev.severity}
                                            </span>
                                          </div>

                                          {/* Current Value */}
                                          <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-500 dark:text-slate-400">Observed Value:</span>
                                            <span className="font-mono font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800/60">
                                              {dev.current_value.toFixed(2)}
                                            </span>
                                          </div>

                                          {/* Baseline Mean & Stddev */}
                                          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-700/40">
                                            <span className="text-[11px]">Normal Baseline:</span>
                                            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                              μ = {dev.baseline_mean.toFixed(2)}, σ = {dev.baseline_stddev.toFixed(2)}
                                            </span>
                                          </div>

                                          {/* Z-Score */}
                                          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-700/40">
                                            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Deviation Delta:</span>
                                            <span
                                              className={`font-mono font-bold px-2 py-0.5 rounded text-xs inline-flex items-center gap-1 ${
                                                isPositiveZ
                                                  ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60'
                                                  : 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60'
                                              }`}
                                            >
                                              {isPositiveZ ? `+${dev.z_score.toFixed(2)}σ` : `${dev.z_score.toFixed(2)}σ`}
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
                  </React.Fragment>
                ))}
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
            className="p-3 border-t flex justify-center"
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