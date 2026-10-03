import { Link, Outlet, useRouterState } from '@tanstack/react-router';
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
import { DemoBanner } from './DemoBanner';
import { MiniTimer } from './MiniTimer';
import { ErrorBoundary } from './ErrorBoundary';
import { cn } from './ui';

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
  // The calendar grid gets a wider column than the other screens.
  const wide = pathname.startsWith('/calendar');

  return (
    <div className="min-h-screen md:flex">
      <aside
        className={cn(
          'flex shrink-0 flex-col border-border bg-sidebar transition-[width] duration-200',
          // Narrow screens: a bar above the content. Wider: a sticky sidebar.
          'border-b px-4 py-3 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 md:py-7',
          collapsed ? 'md:w-[76px] md:px-3' : 'md:w-[232px] md:px-4',
        )}
      >
        <Link
          to="/home"
          aria-label="TradeTime home"
          title={collapsed ? 'TradeTime' : undefined}
          className={cn('flex items-center gap-2.5 self-start rounded-md', collapsed ? 'px-3 md:self-center md:px-0' : 'px-3')}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ember" aria-hidden />
          <span className={cn(collapsed && 'md:hidden')}>
            <Wordmark />
          </span>
        </Link>
        <nav aria-label="Main" className="mt-3 flex gap-0.5 overflow-x-auto md:mt-7 md:flex-1 md:flex-col md:overflow-visible">
          {nav.map(({ to, label, icon }) => (
            <NavItem key={to} to={to} label={label} icon={icon} collapsed={collapsed} />
          ))}
          <span className="md:hidden">
            <NavItem to="/settings" label="Settings" icon={SettingsIcon} collapsed={false} />
          </span>
        </nav>
        <div className="mt-auto hidden flex-col gap-0.5 md:flex">
          <NavItem to="/settings" label="Settings" icon={SettingsIcon} collapsed={collapsed} textOnly />
          <RailButton label={theme.label} icon={theme.icon} collapsed={collapsed} onClick={() => updateSettings.mutate({ theme: theme.next })} />
          <RailButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            hint="⌘\"
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            collapsed={collapsed}
            onClick={toggleCollapsed}
            ariaExpanded={!collapsed}
          />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <DemoBanner />
        <main className="px-4 pt-6 pb-24 sm:px-8 md:px-12 md:pt-8 md:pb-24">
          <div className={cn('mx-auto', wide ? 'max-w-[1240px]' : 'max-w-[1120px]')}>
            <ErrorBoundary resetKey={pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <MiniTimer />
      <CheckInPrompt />
    </div>
  );
}

// 44px rows with a 10px radius; the active page gets the nav-active fill and medium weight.
const itemClass = (collapsed: boolean) =>
  cn(
    'group relative flex min-h-11 shrink-0 items-center gap-3 rounded-md px-3 text-sm whitespace-nowrap text-secondary transition hover:bg-hover hover:text-text',
    '[&.active]:bg-nav-active [&.active]:font-medium [&.active]:text-text',
    collapsed && 'md:w-[52px] md:justify-center md:px-0',
  );

/** Label shown beside an icon when the rail is collapsed (on hover or keyboard focus). */
function RailTip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute top-1/2 left-full z-50 ml-3 hidden -translate-y-1/2 rounded-md bg-text px-2.5 py-1 text-xs whitespace-nowrap text-card shadow-menu md:group-hover:block md:group-focus-visible:block"
    >
      {children}
    </span>
  );
}

function NavItem({ to, label, icon: Icon, collapsed, textOnly = false }: { to: string; label: string; icon: LucideIcon; collapsed: boolean; textOnly?: boolean }) {
  return (
    <Link to={to} className={itemClass(collapsed)} aria-label={collapsed ? label : undefined}>
      {/* Settings is plain text in the full sidebar (as in the design); icons appear on the collapsed rail. */}
      <Icon size={18} strokeWidth={1.6} aria-hidden className={cn(textOnly && !collapsed && 'hidden')} />
      <span className={cn(collapsed && 'md:hidden')}>{label}</span>
      {collapsed && <RailTip>{label}</RailTip>}
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
    <button
      type="button"
      className={cn(itemClass(collapsed), 'w-full text-left')}
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      aria-expanded={ariaExpanded}
      title={!collapsed && hint ? `${label} (${hint})` : undefined}
    >
      <Icon size={18} strokeWidth={1.6} aria-hidden className={cn(!collapsed && 'hidden')} />
      {!collapsed && label}
      {collapsed && (
        <RailTip>
          {label}
          {hint && <span className="ml-1.5 opacity-60">{hint}</span>}
        </RailTip>
      )}
    </button>
  );
}

/** TradeTime wordmark: one word, "Trade" in bold. */
export function Wordmark({ className = 'text-[15px]' }: { className?: string }) {
  return (
    <span className={`leading-none tracking-[-0.01em] ${className}`}>
      <span className="font-bold">Trade</span>
      <span className="font-normal">Time</span>
    </span>
  );
}
