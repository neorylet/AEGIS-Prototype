import { useState, useEffect, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  Play,
  Square,
  RefreshCw,
  Download,
  AlertTriangle,
  Cpu,
  Activity,
  Radio,
  Search,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Globe,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import { commands } from '../services/tauri';
import {
  EnrichedEvent,
  EventStatus,
  AssetAnomaly,
  AnomalySeverity,
  EventCounts,
  HourlyEvents,
} from '../types';

/* =========================================================================
   SOLID HIGH-CONTRAST SEVERITY BADGES
   ========================================================================= */
const severityBadgeClass = (s: AnomalySeverity): string => {
  switch (s) {
    case 'Critical':
      return 'bg-rose-600 text-white shadow-xs font-semibold';
    case 'High':
      return 'bg-amber-600 text-white shadow-xs font-semibold';
    case 'Medium':
      return 'bg-orange-600 text-white shadow-xs font-semibold';
    case 'Low':
    default:
      return 'bg-slate-800 text-white dark:bg-slate-700 dark:text-slate-100 font-medium';
  }
};

const getEventStatusBadge = (status: EventStatus): string => {
  switch (status) {
    case 'Critical':
      return 'bg-rose-600 text-white font-semibold';
    case 'Warning':
    case 'Anomaly':
      return 'bg-amber-600 text-white font-semibold';
    case 'Network':
      return 'bg-slate-800 text-sky-300 dark:bg-slate-700 dark:text-sky-300 font-medium';
    case 'Resolved':
      return 'bg-emerald-600 text-white font-semibold';
    case 'Info':
    default:
      return 'bg-slate-800 text-white dark:bg-slate-700 dark:text-slate-100 font-medium';
  }
};

const formatAssetLabel = (a: AssetAnomaly): string => {
  if (a.asset_type === 'Process') return `${a.display_name} (Process)`;
  return a.display_name;
};

const formatSourceLabel = (source: string): string =>
  source
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const Dashboard = () => {
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  const [rawEvents, setRawEvents] = useState<EnrichedEvent[]>([]);
  const [anomalies, setAnomalies] = useState<AssetAnomaly[]>([]);
  const [eventCounts, setEventCounts] = useState<EventCounts | null>(null);
  const [hourlyEvents, setHourlyEvents] = useState<HourlyEvents[]>([]);
  const [assetCount, setAssetCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [initialLoad, setInitialLoad] = useState<boolean>(true);
  const [controlsDisabled, setControlsDisabled] = useState<boolean>(false);
  const [lastAnalysisAt, setLastAnalysisAt] = useState<Date | null>(null);
  const [monitoringStartedAt, setMonitoringStartedAt] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Filters & State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hideLoopback, setHideLoopback] = useState<boolean>(true);
  const [selectedType, setSelectedType] = useState<'all' | 'process' | 'network'>('all');
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);

  const isLoopback = useCallback((event: EnrichedEvent): boolean => {
    if ('Network' in event.event) {
      const data = event.event.Network;
      const { local_ip, remote_ip } = data;
      return (
        local_ip.startsWith('127.') ||
        remote_ip.startsWith('127.') ||
        local_ip === '0.0.0.0' ||
        remote_ip === '0.0.0.0' ||
        local_ip === '[::]' ||
        remote_ip === '[::]' ||
        local_ip === '::1' ||
        remote_ip === '::1'
      );
    }
    return false;
  }, []);

  const loadEvents = async (): Promise<void> => {
    console.log('[DEBUG] loadEvents called');
    try {
      const events = await commands.getRecentEvents(100);
      setRawEvents(events);
    } catch (error) {
      console.error('Failed to load events:', error);
    }
  };

  const loadAnomalies = async (): Promise<void> => {
    try {
      const a = await commands.getAnomalies(25);
      setAnomalies(a);
    } catch (e) {
      console.error('Failed to load anomalies:', e);
    }
  };

  const loadStats = async (): Promise<void> => {
    try {
      const [counts, assets, hourly] = await Promise.all([
        commands.getEventCounts(),
        commands.getAssetCount(),
        commands.getHourlyEvents24h(),
      ]);
      setEventCounts(counts);
      setAssetCount(assets);
      setHourlyEvents(hourly);
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
  };

  const runAnalysisCycle = useCallback(async () => {
    await Promise.all([loadAnomalies(), loadStats()]);
    setLastAnalysisAt(new Date());
  }, []);

  const handleRefreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadEvents(), runAnalysisCycle()]);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [runAnalysisCycle]);

  const handleStartMonitoring = async (): Promise<void> => {
    try {
      setControlsDisabled(true);
      await commands.startMonitoring();
      setIsMonitoring(true);
      setMonitoringStartedAt(new Date());
      setElapsedSeconds(0);
      handleRefreshAll();
    } catch (error) {
      console.error('Failed to start monitoring:', error);
    } finally {
      setControlsDisabled(false);
    }
  };

  const handleStopMonitoring = async (): Promise<void> => {
    try {
      setControlsDisabled(true);
      await commands.stopMonitoring();
      setIsMonitoring(false);
      setMonitoringStartedAt(null);
      setElapsedSeconds(0);
    } catch (error) {
      console.error('Failed to stop monitoring:', error);
    } finally {
      setControlsDisabled(false);
    }
  };

  const handleToggleMonitoring = (): void => {
    if (isMonitoring) {
      handleStopMonitoring();
    } else {
      handleStartMonitoring();
    }
  };

  /* =========================================================================
     COMPLETED EVENT LISTENER EFFECT WITH DEBUG LOGGING
     ========================================================================= */
  useEffect(() => {
    let isMounted = true;
    let unlistenBatch: (() => void) | null = null;
    let unlistenSingle: (() => void) | null = null;
    let intervalStats: ReturnType<typeof setInterval> | undefined;

    const mergeNewEvents = (incoming: EnrichedEvent[]) => {
      if (!incoming || incoming.length === 0) return;

      setRawEvents((prev) => {
        const seen = new Set<string | number>();
        const result: EnrichedEvent[] = [];

        for (const ev of incoming) {
          if (ev && ev.id != null && !seen.has(ev.id)) {
            seen.add(ev.id);
            result.push(ev);
          }
        }

        for (const ev of prev) {
          if (ev && ev.id != null && !seen.has(ev.id)) {
            seen.add(ev.id);
            result.push(ev);
          }
        }

        return result.slice(0, 100);
      });
    };

    if (isMonitoring) {
      console.log('[DEBUG] Setting up listener...');

      // 1. Listen for Batched Events ('new-events-batch')
      listen<EnrichedEvent[]>('new-events-batch', (event) => {
        if (!isMounted) return;
        console.log('[DEBUG] new-events-batch received:', event.payload);
        const batch = event.payload;
        if (Array.isArray(batch) && batch.length > 0) {
          mergeNewEvents([...batch].reverse());
        }
      })
        .then((unsub) => {
          if (!isMounted) {
            unsub();
          } else {
            unlistenBatch = unsub;
            console.log('[DEBUG] new-events-batch listener attached');
          }
        })
        .catch((err) => console.error('Failed to attach new-events-batch listener:', err));

      // 2. Listen for Single Events ('new-event')
      listen<EnrichedEvent>('new-event', (event) => {
        if (!isMounted) return;
        console.log('[DEBUG] new-event received:', event.payload);
        if (event.payload) {
          mergeNewEvents([event.payload]);
        }
      })
        .then((unsub) => {
          if (!isMounted) {
            unsub();
          } else {
            unlistenSingle = unsub;
            console.log('[DEBUG] Listener attached');
          }
        })
        .catch((err) => console.error('Failed to attach new-event listener:', err));

      // Periodic analysis polling
      intervalStats = setInterval(runAnalysisCycle, 2000);
    }

    return () => {
      isMounted = false;
      console.log('[DEBUG] Listener cleaned up');
      if (unlistenBatch) unlistenBatch();
      if (unlistenSingle) unlistenSingle();
      if (intervalStats) clearInterval(intervalStats);
    };
  }, [isMonitoring, runAnalysisCycle]);

  // Live timer for elapsed monitoring duration
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (isMonitoring && monitoringStartedAt) {
      timer = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - monitoringStartedAt.getTime()) / 1000));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isMonitoring, monitoringStartedAt]);

  useEffect(() => {
    handleRefreshAll();
  }, [handleRefreshAll]);

  const filteredEvents = useMemo(() => {
    return rawEvents.filter((e) => {
      if (hideLoopback && isLoopback(e)) return false;
      if (selectedType === 'process' && !('Process' in e.event)) return false;
      if (selectedType === 'network' && !('Network' in e.event)) return false;

      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase();
      const sourceMatches = e.source.toLowerCase().includes(q);

      if ('Process' in e.event) {
        const p = e.event.Process;
        return sourceMatches || p.name.toLowerCase().includes(q) || String(p.pid).includes(q);
      }
      if ('Network' in e.event) {
        const n = e.event.Network;
        return (
          sourceMatches ||
          n.protocol.toLowerCase().includes(q) ||
          n.local_ip.includes(q) ||
          n.remote_ip.includes(q) ||
          String(n.local_port).includes(q) ||
          String(n.remote_port).includes(q)
        );
      }
      return sourceMatches;
    });
  }, [rawEvents, hideLoopback, selectedType, searchQuery, isLoopback]);

  const threatLevel = useMemo(() => {
    if (anomalies.some((a) => a.max_severity === 'Critical')) {
      return {
        label: 'Critical',
        badgeClass: 'bg-rose-600 text-white font-semibold',
      };
    }
    if (anomalies.some((a) => a.max_severity === 'High')) {
      return {
        label: 'High',
        badgeClass: 'bg-amber-600 text-white font-semibold',
      };
    }
    if (anomalies.some((a) => a.max_severity === 'Medium')) {
      return {
        label: 'Medium',
        badgeClass: 'bg-orange-600 text-white font-semibold',
      };
    }
    return {
      label: 'Low',
      badgeClass: 'bg-slate-800 text-white font-medium',
    };
  }, [anomalies]);

  const formatTimestamp = (ts: string): string => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour12: false });
    } catch {
      return ts;
    }
  };

  const formatClockTime = (d: Date): string => d.toLocaleTimeString([], { hour12: false });

  const formatDuration = (totalSeconds: number): string => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const handleExportEvents = () => {
    if (filteredEvents.length === 0) return;
    const blob = new Blob([JSON.stringify(filteredEvents, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegis-events-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const processCount = eventCounts?.process_events ?? rawEvents.filter((e) => 'Process' in e.event).length;
  const networkCount = eventCounts?.network_events ?? rawEvents.filter((e) => 'Network' in e.event).length;
  const totalEventsCount = eventCounts?.total_events ?? rawEvents.length;

  const kpis = [
    {
      label: 'Active Assets',
      value: assetCount > 0 ? assetCount.toLocaleString() : '0',
      subtext: 'Monitored local endpoints',
      icon: Layers,
      iconColor: 'text-sky-600 dark:text-sky-400',
      trendPill: null,
    },
    {
      label: 'Total Events',
      value: Number(totalEventsCount).toLocaleString(),
      subtext: 'Ingested telemetry events',
      icon: Activity,
      iconColor: 'text-indigo-600 dark:text-indigo-400',
      trendPill: (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-800 text-emerald-400 dark:bg-slate-700">
          <ArrowUpRight className="w-3 h-3" />
          Active
        </span>
      ),
    },
    {
      label: 'Process Events',
      value: Number(processCount).toLocaleString(),
      subtext: 'Binaries & background daemons',
      icon: Cpu,
      iconColor: 'text-amber-600 dark:text-amber-400',
      trendPill: null,
    },
    {
      label: 'Network Events',
      value: Number(networkCount).toLocaleString(),
      subtext: 'Sockets & connection flows',
      icon: Globe,
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      trendPill: null,
    },
  ];

  const renderChart = (): JSX.Element => {
    const now = new Date();
    const hourLabels: string[] = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(now.getHours() - i, 0, 0, 0);
      hourLabels.push(`${String(d.getHours()).padStart(2, '0')}:00`);
    }

    let data: number[];
    if (hourlyEvents.length > 0) {
      const map = new Map<string, number>();
      for (const h of hourlyEvents) {
        map.set(h.hour_label, h.total_events);
      }
      const bucketKeys: string[] = [];
      for (let i = 23; i >= 0; i--) {
        const d = new Date(now);
        d.setHours(now.getHours() - i, 0, 0, 0);
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        bucketKeys.push(`${y}-${mo}-${da} ${hh}:00:00`);
      }
      data = bucketKeys.map((k) => Number(map.get(k) ?? 0));
    } else {
      data = hourLabels.map(() => 0);
    }

    const maxData = Math.max(1, ...data);
    const totalEvents = data.reduce((sum, v) => sum + v, 0);
    const avgPerHour = totalEvents / 24;
    const peakIndex = data.reduce((best, v, i) => (v > data[best] ? i : best), 0);
    const hasPeak = data[peakIndex] > 0;

    return (
      <div>
        <div className="flex flex-wrap items-center gap-6 mb-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span style={{ color: 'var(--text-muted)' }}>24h Peak:</span>
            <span className="font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
              {maxData.toLocaleString()}
            </span>
            {hasPeak && (
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                (@ {hourLabels[peakIndex]})
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ color: 'var(--text-muted)' }}>24h Volume:</span>
            <span className="font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
              {totalEvents.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ color: 'var(--text-muted)' }}>Avg/hour:</span>
            <span className="font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
              {avgPerHour.toFixed(1)}
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <div
            style={{ color: 'var(--text-muted)' }}
            className="flex flex-col justify-between h-40 text-[10px] font-mono text-right w-7 shrink-0 select-none pb-1"
          >
            <span>{maxData}</span>
            <span>{Math.round(maxData / 2)}</span>
            <span>0</span>
          </div>

          <div className="relative flex-1 h-40">
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              <div className="border-t border-slate-200/90 dark:border-slate-800" />
              <div className="border-t border-dashed border-slate-200/70 dark:border-slate-800/80" />
              <div className="border-t border-slate-200/90 dark:border-slate-800" />
            </div>

            <div className="absolute inset-0 flex items-end gap-1 px-1">
              {data.map((value, index) => {
                const isPeak = hasPeak && index === peakIndex;
                const isHovered = hoveredBarIndex === index;
                const heightPct = Math.max(value > 0 ? 6 : 2, (value / maxData) * 100);

                return (
                  <div
                    key={index}
                    onMouseEnter={() => setHoveredBarIndex(index)}
                    onMouseLeave={() => setHoveredBarIndex(null)}
                    className="relative flex-1 h-full flex items-end cursor-pointer"
                  >
                    <div
                      className={`w-full rounded-t-sm transition-all duration-150 ${
                        isPeak
                          ? 'bg-sky-500 dark:bg-sky-400'
                          : isHovered
                          ? 'bg-sky-400 dark:bg-sky-300'
                          : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700/80 dark:hover:bg-slate-600'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />

                    {isHovered && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none whitespace-nowrap px-2.5 py-1 bg-slate-900 text-white dark:bg-slate-800 text-[11px] font-mono rounded shadow-lg border border-slate-700">
                        <div className="font-semibold">{hourLabels[index]}</div>
                        <div className="text-sky-300">{value.toLocaleString()} events</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div
          style={{ color: 'var(--text-muted)' }}
          className="flex mt-2 pl-10 text-[10px] font-mono select-none"
        >
          {hourLabels.map((label, index) => (
            <div key={index} className="flex-1 text-center">
              {index % 4 === 0 ? label : ''}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleMonitoring}
            disabled={controlsDisabled}
            className={`px-4 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center gap-2 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed ${
              isMonitoring
                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20'
                : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-600/20'
            }`}
          >
            {isMonitoring ? (
              <Square className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>{isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}</span>
          </button>

          <button
            onClick={handleRefreshAll}
            disabled={loading}
            style={{
              borderColor: 'var(--border)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
            }}
            className="px-3.5 py-2 rounded-lg text-xs font-medium border hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-600' : 'text-slate-400'}`}
            />
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1 hidden sm:block" />

          <label
            style={{ color: 'var(--text-secondary)' }}
            className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <input
              type="checkbox"
              checked={hideLoopback}
              onChange={(e) => setHideLoopback(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700 text-sky-600 focus:ring-sky-500"
            />
            <span>Hide Loopback</span>
          </label>
        </div>

        <div className="flex items-center gap-4">
          {isMonitoring && (
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border)',
                color: 'var(--text-secondary)',
              }}
              className="flex items-center gap-1.5 text-xs font-mono border px-3 py-1.5 rounded-lg shadow-2xs"
            >
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Uptime: {formatDuration(elapsedSeconds)}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {isMonitoring && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isMonitoring ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
              />
            </span>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {isMonitoring ? 'Collector Active' : 'Collector Idle'}
            </span>
          </div>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              className="aegis-card aegis-card-hover p-5 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
                  {kpi.label}
                </span>
                <span className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <Icon className={`w-4 h-4 ${kpi.iconColor}`} />
                </span>
              </div>

              <div className="flex items-baseline justify-between mb-2">
                <span
                  style={{ color: 'var(--text-primary)' }}
                  className="text-3xl font-bold font-mono tracking-tight tabular-nums"
                >
                  {initialLoad && loading ? '—' : kpi.value}
                </span>
                {kpi.trendPill}
              </div>

              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {kpi.subtext}
              </div>
            </div>
          );
        })}
      </div>

      {/* Center Grid: Activity Chart + System Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 aegis-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Telemetry Volume (Last 24 Hours)
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Aggregated system calls and connection traffic
              </p>
            </div>
            {hourlyEvents.length === 0 && (
              <span className="text-xs font-mono italic" style={{ color: 'var(--text-muted)' }}>
                (Bins populate hourly)
              </span>
            )}
          </div>
          {renderChart()}
        </div>

        <div className="aegis-card p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>
              System Health & Posture
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              Real-time analysis baseline status
            </p>

            <div
              style={{ borderColor: 'var(--border)' }}
              className="space-y-3.5 divide-y divide-slate-100 dark:divide-slate-800 text-xs"
            >
              <div className="flex justify-between items-center pt-2">
                <span className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                  <ShieldCheck className="w-4 h-4 text-slate-400" />
                  Agent Engine
                </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Operational
                </span>
              </div>

              <div className="flex justify-between items-center pt-3.5">
                <span className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                  <AlertTriangle className="w-4 h-4 text-slate-400" />
                  Threat Level
                </span>
                <span className={`px-2.5 py-0.5 rounded text-[11px] ${threatLevel.badgeClass}`}>
                  {threatLevel.label}
                </span>
              </div>

              <div className="flex justify-between items-center pt-3.5">
                <span style={{ color: 'var(--text-secondary)' }}>Data Retention</span>
                <span className="font-medium font-mono" style={{ color: 'var(--text-primary)' }}>
                  30 Days (SQLite WAL)
                </span>
              </div>

              <div className="flex justify-between items-center pt-3.5">
                <span style={{ color: 'var(--text-secondary)' }}>Last Analysis Cycle</span>
                <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                  {isMonitoring && lastAnalysisAt ? formatClockTime(lastAnalysisAt) : 'Pending'}
                </span>
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-app)',
              borderColor: 'var(--border)',
              color: 'var(--text-muted)',
            }}
            className="mt-6 p-3 rounded-lg border text-[11px] leading-relaxed"
          >
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              Z-Score Engine:{' '}
            </span>
            Calculates dynamic statistical standard deviations against running asset baselines.
          </div>
        </div>
      </div>

      {/* Behavioral Anomalies */}
      <div className="aegis-card overflow-hidden">
        <div
          style={{
            borderBottomColor: 'var(--border)',
            backgroundColor: 'var(--bg-subtle)',
          }}
          className="p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-slate-800 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Behavioral Anomalies
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Statistical deviations flagged from dynamic baselines
              </p>
            </div>
            {anomalies.length > 0 && (
              <span className="ml-2 px-2.5 py-0.5 text-xs font-semibold rounded bg-rose-600 text-white shadow-xs">
                {anomalies.length} Flagged
              </span>
            )}
          </div>
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            min. 3 sample windows required
          </span>
        </div>

        {anomalies.length === 0 ? (
          <div className="p-10 text-center">
            <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              No active anomalies detected
            </h4>
            <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
              System operations are within expected baseline variance.
            </p>
          </div>
        ) : (
          <div
            style={{ borderColor: 'var(--border)' }}
            className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800"
          >
            {anomalies.map((a) => {
              const top = [...a.deviations].sort(
                (x, y) => Math.abs(y.z_score) - Math.abs(x.z_score)
              )[0];

              return (
                <div
                  key={a.asset_id}
                  className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        style={{
                          backgroundColor: 'var(--bg-app)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-secondary)',
                        }}
                        className="w-9 h-9 rounded-lg flex items-center justify-center border shrink-0"
                      >
                        {a.asset_type === 'Process' ? (
                          <Cpu className="w-4 h-4" />
                        ) : (
                          <Radio className="w-4 h-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {formatAssetLabel(a)}
                        </div>
                        <div className="text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                          {formatTimestamp(a.detected_at)} · {a.event_count} events recorded
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                          Score
                        </div>
                        <div className="text-base font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
                          {a.overall_score.toFixed(1)}
                        </div>
                      </div>

                      <span className={`px-2.5 py-1 rounded text-xs ${severityBadgeClass(a.max_severity)}`}>
                        {a.max_severity}
                      </span>
                    </div>
                  </div>

                  {top && (
                    <div className="ml-12 flex items-center gap-2 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Top deviation:</span>
                      <span
                        style={{
                          backgroundColor: 'var(--bg-app)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)',
                        }}
                        className="px-1.5 py-0.5 rounded border font-medium"
                      >
                        {top.feature_name}
                      </span>
                      <span>= {top.current_value.toFixed(1)}</span>
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        (z={top.z_score.toFixed(2)})
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Events Table */}
      <div className="aegis-card overflow-hidden">
        <div
          style={{
            borderBottomColor: 'var(--border)',
            backgroundColor: 'var(--bg-subtle)',
          }}
          className="p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Recent Events
            </h3>
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              ({filteredEvents.length} displayed)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search PID, IP, binary..."
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 w-48 sm:w-56"
              />
            </div>

            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border)',
              }}
              className="flex rounded-lg border p-0.5 text-xs"
            >
              {(['all', 'process', 'network'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedType(t)}
                  style={{
                    backgroundColor: selectedType === t ? 'var(--bg-surface-hover)' : 'transparent',
                    color: selectedType === t ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                  className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                    selectedType === t ? 'font-semibold shadow-2xs' : 'hover:text-slate-800 dark:hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <button
              onClick={handleExportEvents}
              disabled={filteredEvents.length === 0}
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border)',
                color: 'var(--text-secondary)',
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="p-10 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            No events match your current filter criteria.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-muted)',
                }}
                className="sticky top-0 border-b text-[11px] font-semibold uppercase tracking-wider select-none z-10"
              >
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Telemetry Payload</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody
                style={{ borderColor: 'var(--border)' }}
                className="divide-y divide-slate-100 dark:divide-slate-800 text-xs"
              >
                {filteredEvents.map((event) => (
                  <tr
                    key={event.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td
                      style={{ color: 'var(--text-muted)' }}
                      className="px-4 py-3 font-mono whitespace-nowrap"
                    >
                      {formatTimestamp(event.timestamp)}
                    </td>
                    <td
                      style={{ color: 'var(--text-primary)' }}
                      className="px-4 py-3 font-medium whitespace-nowrap"
                    >
                      {formatSourceLabel(event.source)}
                    </td>
                    <td
                      style={{ color: 'var(--text-secondary)' }}
                      className="px-4 py-3 whitespace-nowrap"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {'Process' in event.event ? (
                          <Cpu className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <Radio className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        {'Process' in event.event ? 'Process' : 'Network'}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      {'Process' in event.event ? (
                        <div className="flex items-center gap-2 font-mono text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                          <span
                            style={{
                              backgroundColor: 'var(--bg-app)',
                              borderColor: 'var(--border)',
                              color: 'var(--text-primary)',
                            }}
                            className="border px-1.5 py-0.5 rounded text-[11px] font-semibold"
                          >
                            PID {event.event.Process.pid}
                          </span>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {event.event.Process.name}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span>CPU: {event.event.Process.cpu_usage.toFixed(1)}%</span>
                          <span className="text-slate-400">·</span>
                          <span>
                            Mem: {(event.event.Process.memory_usage / 1024 / 1024).toFixed(1)}MB
                          </span>
                        </div>
                      ) : 'Network' in event.event ? (
                        <div className="flex items-center gap-2 font-mono text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                          <span className="bg-slate-800 text-sky-300 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold">
                            {event.event.Network.protocol}
                          </span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {event.event.Network.local_ip}:{event.event.Network.local_port}
                          </span>
                          <span className="text-slate-400">→</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {event.event.Network.remote_ip}:{event.event.Network.remote_port}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>N/A</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded text-[11px] ${getEventStatusBadge(
                        'Process' in event.event ? 'Info' : 'Network'
                      )}`}>
                        {'Process' in event.event ? 'Process' : 'Network'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};