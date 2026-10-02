import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { ErrorBoundary } from './ErrorBoundary';
import { cn } from './ui';
import {
  BookOpen,
  CalendarDays,
  House,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings as SettingsIcon,
  Sun,
  Target,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Theme } from '../lib/api';
import { useSettings, useUpdateSettings } from '../lib/settings';
import { useThemeSync } from '../lib/theme';
import { CheckInPrompt } from '../pages/checkins/CheckInPrompt';

const nav = [
  { to: '/home', label: 'Home', icon: House },
  { to: '/journal', label: 'Journal', icon: BookOpen },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/time-log', label: 'Time log', icon: Timer },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/playbook', label: 'Playbook', icon: Target },
] as const;

const themeCycle: Record<Theme, { next: Theme; icon: typeof Sun; label: string }> = {
  system: { next: 'light', icon: Monitor, label: 'Theme: system' },
  light: { next: 'dark', icon: Sun, label: 'Theme: light' },
  dark: { next: 'system', icon: Moon, label: 'Theme: dark' },
};

const COLLAPSED_KEY = 'tc-sidebar-collapsed';

/** Sidebar collapsed to an icon rail, remembered per browser. Toggle with ⌘\ (Ctrl+\ elsewhere). */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // Not critical.
    }
  }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [collapsed, () => setCollapsed((c) => !c)];
}

export function AppShell() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  useThemeSync(settings?.theme);
  const theme = themeCycle[settings?.theme ?? 'system'];
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-bg py-6 transition-[width,padding] duration-200',
          collapsed ? 'w-[76px] px-3' : 'w-60 px-4',
        )}
      >
        <Link to="/home" className={cn('mb-10', collapsed ? 'flex justify-center' : 'px-4')} aria-label="TradeTime home" title={collapsed ? 'TradeTime' : undefined}>
          {collapsed ? <Monogram /> : <Wordmark />}
        </Link>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
          {nav.map(({ to, label, icon }) => (
            <NavItem key={to} to={to} label={label} icon={icon} collapsed={collapsed} />
          ))}
        </nav>
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <NavItem to="/settings" label="Settings" icon={SettingsIcon} collapsed={collapsed} />
          <RailButton label={theme.label} icon={theme.icon} collapsed={collapsed} onClick={() => updateSettings.mutate({ theme: theme.next })} />
          <RailButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            hint={"⌘\\"}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            collapsed={collapsed}
            onClick={toggleCollapsed}
            ariaExpanded={!collapsed}
          />
        </div>
      </aside>
      <main className={cn('min-w-0 flex-1 py-10 transition-[padding] duration-200', collapsed ? 'px-12' : 'px-10')}>
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <CheckInPrompt />
    </div>
  );
}

// Pill-shaped nav items; the active page sits in an Ash capsule with a small Ember marker.
const itemClass = (collapsed: boolean) =>
  cn(
    'font-display group relative flex items-center rounded-full py-2 text-[15px] text-muted transition hover:text-text [&.active]:bg-surface [&.active]:text-text',
    'focus-visible:outline-2 focus-visible:outline-ember',
    collapsed ? 'h-10 w-[52px] justify-center px-0' : 'gap-3 px-4',
  );

/** Label shown beside an icon when the rail is collapsed (on hover or keyboard focus). */
function RailTip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute top-1/2 left-full z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-text px-3 py-1 font-sans text-xs text-bg group-hover:block group-focus-visible:block"
    >
      {children}
    </span>
  );
}

function NavItem({ to, label, icon: Icon, collapsed }: { to: string; label: string; icon: LucideIcon; collapsed: boolean }) {
  return (
    <Link to={to} className={itemClass(collapsed)} aria-label={collapsed ? label : undefined}>
      <Icon size={17} strokeWidth={1.6} aria-hidden />
      {collapsed ? <RailTip>{label}</RailTip> : label}
      <span
        className={cn('hidden h-1.5 w-1.5 rounded-full bg-ember group-[.active]:block', collapsed ? 'absolute top-1.5 right-2.5' : 'ml-auto')}
        aria-hidden
      />
    </Link>
  );
}

function RailButton({
  label,
  hint,
  icon: Icon,
  collapsed,
  onClick,
  ariaExpanded,
}: {
  label: string;
  hint?: string;
  icon: LucideIcon;
  collapsed: boolean;
  onClick: () => void;
  ariaExpanded?: boolean;
}) {
  return (
    <button type="button" className={itemClass(collapsed)} onClick={onClick} aria-label={collapsed ? label : undefined} aria-expanded={ariaExpanded} title={!collapsed && hint ? `${label} (${hint})` : undefined}>
      <Icon size={17} strokeWidth={1.6} aria-hidden />
      {collapsed ? (
        <RailTip>
          {label}
          {hint && <span className="ml-1.5 opacity-60">{hint}</span>}
        </RailTip>
      ) : (
        label
      )}
    </button>
  );
}

/** TradeTime wordmark: one word, "Trade" in bold, set in the display face. */
export function Wordmark({ className = 'text-[22px]' }: { className?: string }) {
  return (
    <span className={`font-display leading-none tracking-[-0.03em] ${className}`}>
      <span className="font-semibold">Trade</span>
      <span>Time</span>
    </span>
  );
}

/** Compact mark for the collapsed rail: bold T, regular t, with the Ember dot. */
function Monogram() {
  return (
    <span className="font-display relative flex h-10 w-10 items-center justify-center rounded-[6px_0_0_0] bg-text text-[19px] leading-none tracking-[-0.04em] text-bg">
      <span className="font-semibold">T</span>
      <span>t</span>
      <span className="absolute right-1.5 bottom-1.5 h-1.5 w-1.5 rounded-full bg-ember" aria-hidden />
    </span>
  );
}
