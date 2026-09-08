import { useState, useEffect } from 'react';
import {
  ShieldHalf,
  LayoutDashboard,
  Cpu,
  Activity,
  AlertTriangle,
  ShieldAlert,
  FileText,
  Crosshair,
  Settings as SettingsIcon,
  Sun,
  Moon,
} from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Events } from './pages/Events';
import { Alerts } from './pages/Alerts';
import { Incidents } from './pages/Incidents';
import { Policies } from './pages/Policies';
import { Hunting } from './pages/Hunting';
import { Settings } from './pages/Settings';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'devices', label: 'Devices', icon: Cpu },
  { id: 'events', label: 'Events', icon: Activity },
  { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
  { id: 'incidents', label: 'Incidents', icon: ShieldAlert },
  { id: 'policies', label: 'Policies', icon: FileText },
  { id: 'hunting', label: 'Threat Hunting', icon: Crosshair },
];

const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Security Overview',
  devices: 'Monitored Devices',
  events: 'Event Log Stream',
  alerts: 'Detection Alerts',
  incidents: 'Incident Response',
  policies: 'Compliance & Policies',
  hunting: 'Threat Hunting',
  settings: 'System Settings',
};

function App(): JSX.Element {
  const [activeSection, setActiveSection] = useState<string>('dashboard');
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem('aegis_theme') === 'dark';
  });

  // Sync dark class and data-theme to root element
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
      localStorage.setItem('aegis_theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
      localStorage.setItem('aegis_theme', 'light');
    }
  }, [isDark]);

  const renderContent = (): JSX.Element => {
    switch (activeSection) {
      case 'dashboard':
        return <Dashboard />;
      case 'devices':
        return <Devices />;
      case 'events':
        return <Events />;
      case 'alerts':
        return <Alerts />;
      case 'incidents':
        return <Incidents />;
      case 'policies':
        return <Policies />;
      case 'hunting':
        return <Hunting />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)' }}
      className="flex h-screen overflow-hidden font-sans transition-colors duration-200"
    >
      {/* Sidebar */}
      <aside
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          borderColor: 'var(--sidebar-border)',
        }}
        className="w-60 flex-shrink-0 border-r flex flex-col h-full z-10 transition-colors duration-200"
      >
        {/* Brand Header */}
        <div
          style={{ borderColor: 'var(--sidebar-border)' }}
          className="h-16 flex items-center justify-between px-5 border-b flex-shrink-0"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shadow-sm shadow-sky-600/30">
              <ShieldHalf className="w-4 h-4" />
            </div>
            <div>
              <span
                className="text-sm font-bold tracking-tight block"
                style={{ color: 'var(--text-primary)' }}
              >
                AEGIS
              </span>
              <span
                className="text-[10px] uppercase font-mono tracking-wider block"
                style={{ color: 'var(--text-muted)' }}
              >
                EDR AGENT
              </span>
            </div>
          </div>
          <span
            style={{
              backgroundColor: 'var(--bg-surface-hover)',
              color: 'var(--text-muted)',
            }}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold"
          >
            v2.4
          </span>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                style={{
                  backgroundColor: isActive ? 'var(--sidebar-item-active)' : 'transparent',
                  color: isActive ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'font-semibold shadow-xs'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <Icon
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: isActive ? 'var(--accent)' : 'inherit' }}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom Utility: Theme Switcher & Settings */}
        <div
          style={{ borderColor: 'var(--sidebar-border)' }}
          className="p-3 border-t flex-shrink-0 space-y-1"
        >
          {/* Theme Toggle Button */}
          <button
            onClick={() => setIsDark(!isDark)}
            style={{ color: 'var(--sidebar-text)' }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
          >
            <span className="flex items-center gap-2.5">
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-500" />
              )}
              <span>{isDark ? 'Switch to Light' : 'Switch to Dark'}</span>
            </span>
            <span
              style={{
                backgroundColor: 'var(--bg-surface-hover)',
                color: 'var(--text-muted)',
              }}
              className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded font-semibold"
            >
              {isDark ? 'Dark' : 'Light'}
            </span>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setActiveSection('settings')}
            style={{
              backgroundColor: activeSection === 'settings' ? 'var(--sidebar-item-active)' : 'transparent',
              color: activeSection === 'settings' ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
          >
            <SettingsIcon className="w-4 h-4 flex-shrink-0" />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with High-Contrast Live Badge */}
        <header
          style={{
            backgroundColor: 'var(--header-bg)',
            borderColor: 'var(--header-border)',
          }}
          className="h-16 border-b flex items-center justify-between px-8 flex-shrink-0 transition-colors duration-200"
        >
          <div>
            <h1
              className="text-sm font-semibold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              {SECTION_LABELS[activeSection] ?? 'Dashboard'}
            </h1>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Host Telemetry & Threat Surveillance
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            {/* Solid High-Contrast Endpoint Pill (Matches Process & Low) */}
            <span className="flex items-center gap-2 bg-slate-900 text-white dark:bg-slate-800 dark:text-slate-100 px-3 py-1 rounded-md font-medium shadow-xs select-none">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live Endpoint</span>
            </span>
            <span style={{ color: 'var(--border)' }}>|</span>
            <span style={{ color: 'var(--text-muted)' }}>Host: Localhost</span>
          </div>
        </header>

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto">{renderContent()}</div>
        </main>
      </div>
    </div>
  );
}

export default App;