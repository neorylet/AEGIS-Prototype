import { useState, useEffect, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  RefreshCw,
  Download,
  Cpu,
  Radio,
  Search,
  ChevronDown,
} from 'lucide-react';
import { commands } from '../services/tauri';
import { EnrichedEvent, EventStatus } from '../types';

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

const formatSourceLabel = (source: string): string =>
  source
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const formatTimestamp = (ts: string): string => {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour12: false });
  } catch {
    return ts;
  }
};

export const Events = () => {
  const [events, setEvents] = useState<EnrichedEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [listenerActive, setListenerActive] = useState<boolean>(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<'all' | 'process' | 'network'>('all');
  const [selectedSource, setSelectedSource] = useState<'all' | 'process_poller' | 'connection_poller'>('all');
  const [limit, setLimit] = useState<number>(100);

  const loadEvents = useCallback(async (currentLimit: number = limit) => {
    try {
      setLoading(true);
      const fetched = await commands.getRecentEvents(currentLimit);
      setEvents(fetched);
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const handleLoadMore = () => {
    setLimit((prev) => prev + 100);
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

  // Real-time event listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      if (!listenerActive) {
        unlisten = await listen<EnrichedEvent>('new-event', (event) => {
          console.log('[DEBUG] Events page received new-event:', event.payload);
          setEvents((prev) => {
            const updated = [event.payload, ...prev];
            return updated.slice(0, limit);
          });
        });
        setListenerActive(true);
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
      setListenerActive(false);
    };
  }, [listenerActive, limit]);

  // Load events on mount and when limit changes
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (selectedType === 'process' && !('Process' in e.event)) return false;
      if (selectedType === 'network' && !('Network' in e.event)) return false;
      if (selectedSource !== 'all' && e.source !== selectedSource) return false;

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
  }, [events, selectedType, selectedSource, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="aegis-card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Event Log
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

            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border)',
              }}
              className="flex rounded-lg border p-0.5 text-xs"
            >
              {(['all', 'process_poller', 'connection_poller'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedSource(s)}
                  style={{
                    backgroundColor: selectedSource === s ? 'var(--bg-surface-hover)' : 'transparent',
                    color: selectedSource === s ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                  className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                    selectedSource === s ? 'font-semibold shadow-2xs' : 'hover:text-slate-800 dark:hover:text-white'
                  }`}
                >
                  {s === 'all' ? 'All Sources' : formatSourceLabel(s)}
                </button>
              ))}
            </div>

            <button
              onClick={() => loadEvents()}
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
      </div>

      {/* Events Table */}
      <div className="aegis-card overflow-hidden">
        {filteredEvents.length === 0 ? (
          <div className="p-10 text-center">
            <div
              style={{
                backgroundColor: 'var(--bg-app)',
                borderColor: 'var(--border)',
                color: 'var(--text-muted)',
              }}
              className="mx-auto mb-3 w-12 h-12 rounded-lg flex items-center justify-center border"
            >
              <Search className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              No events match your criteria
            </h4>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Try adjusting your filters or search query
            </p>
          </div>
        ) : (
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
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Details</th>
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
                      <span
                        className={`px-2.5 py-1 rounded text-[11px] ${getEventStatusBadge(
                          'Process' in event.event ? 'Info' : 'Network'
                        )}`}
                      >
                        {'Process' in event.event ? 'Process' : 'Network'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Load More */}
        {events.length >= limit && (
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
              className="px-4 py-2 rounded-lg text-xs font-medium border hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <ChevronDown className="w-4 h-4" />
              <span>Load More Events</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

