import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import {
  BookOpen,
  CalendarDays,
  House,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  LogOut,
  Settings as SettingsIcon,
  Sun,
  Target,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Theme } from '../lib/api';
import { authEnabled, signOut } from '../lib/auth';
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
      <PhoneTopBar />
      <aside
        className={cn(
          // Tablets and up: a sticky sidebar. Phones use the top bar and bottom tabs instead.
          'hidden shrink-0 flex-col border-r border-border bg-sidebar py-7 transition-[width] duration-200 md:sticky md:top-0 md:flex md:h-screen',
          collapsed ? 'w-[76px] px-3' : 'w-[232px] px-4',
        )}
      >
        <Link
          to="/home"
          aria-label="TradeTime home"
          title={collapsed ? 'TradeTime' : undefined}
          className={cn('flex items-center gap-2.5 rounded-md', collapsed ? 'self-center' : 'self-start px-3')}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ember" aria-hidden />
          <span className={cn(collapsed && 'hidden')}>
            <Wordmark />
          </span>
        </Link>
        <nav aria-label="Main" className="mt-7 flex flex-1 flex-col gap-0.5">
          {nav.map(({ to, label, icon }) => (
            <NavItem key={to} to={to} label={label} icon={icon} collapsed={collapsed} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5">
          <NavItem to="/settings" label="Settings" icon={SettingsIcon} collapsed={collapsed} textOnly />
          <RailButton label={theme.label} icon={theme.icon} collapsed={collapsed} onClick={() => updateSettings.mutate({ theme: theme.next })} />
          {authEnabled && <RailButton label="Sign out" icon={LogOut} collapsed={collapsed} onClick={() => void signOut()} />}
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
        <main className="px-4 pt-5 pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-8 md:px-12 md:pt-8 md:pb-24">
          <div className={cn('mx-auto', wide ? 'max-w-[1240px]' : 'max-w-[1120px]')}>
            <ErrorBoundary resetKey={pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <MiniTimer />
      <CheckInPrompt />
      <PhoneTabBar themeLabel={theme.label} onTheme={() => updateSettings.mutate({ theme: theme.next })} />
    </div>
  );
}

/** Phones: the wordmark in a slim bar that clears the status bar / notch when installed. */
function PhoneTopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-sidebar/95 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <div className="flex h-12 items-center px-4">
        <Link to="/home" aria-label="TradeTime home" className="flex items-center gap-2.5 rounded-md">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ember" aria-hidden />
          <Wordmark />
        </Link>
      </div>
    </header>
  );
}

const phoneTabs = nav.slice(0, 4);
const moreItems = [...nav.slice(4), { to: '/settings', label: 'Settings', icon: SettingsIcon }] as const;

/** Phones: four main tabs plus More (Expenses, Playbook, Settings, theme, sign out), above the home indicator. */
function PhoneTabBar({ themeLabel, onTheme }: { themeLabel: string; onTheme: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const moreActive = moreItems.some((i) => pathname.startsWith(i.to));
  const tabClass = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-md text-[11px] text-muted [&.active]:font-medium [&.active]:text-text';

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}
      {open && (
        <div
          ref={sheet}
          role="dialog"
          aria-label="More"
          className="fixed inset-x-3 bottom-[calc(72px+env(safe-area-inset-bottom))] z-50 rounded-lg border border-border bg-card p-2 shadow-menu md:hidden"
        >
          {moreItems.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="flex min-h-12 items-center gap-3 rounded-md px-3 text-[15px] text-secondary hover:bg-hover [&.active]:bg-nav-active [&.active]:font-medium [&.active]:text-text">
              <Icon size={18} strokeWidth={1.6} aria-hidden /> {label}
            </Link>
          ))}
          <div className="my-1 border-t border-border-subtle" />
          <button type="button" onClick={onTheme} className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] text-secondary hover:bg-hover">
            <Monitor size={18} strokeWidth={1.6} aria-hidden /> {themeLabel}
          </button>
          {authEnabled && (
            <button type="button" onClick={() => void signOut()} className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] text-secondary hover:bg-hover">
              <LogOut size={18} strokeWidth={1.6} aria-hidden /> Sign out
            </button>
          )}
        </div>
      )}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-sidebar/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {phoneTabs.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className={tabClass}>
            <Icon size={20} strokeWidth={1.6} aria-hidden />
            {label}
          </Link>
        ))}
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn(tabClass, (moreActive || open) && 'font-medium text-text')}>
          <MoreHorizontal size={20} strokeWidth={1.6} aria-hidden />
          More
        </button>
      </nav>
    </>
  );
}

// 44px rows with a 10px radius; the active page gets the nav-active fill and medium weight.
const itemClass = (collapsed: boolean) =>
  cn(
    'group relative flex min-h-11 shrink-0 items-center gap-3 rounded-md px-3 text-sm whitespace-nowrap text-secondary transition hover:bg-hover hover:text-text',
    '[&.active]:bg-nav-active [&.active]:font-medium [&.active]:text-text',
    collapsed && 'w-[52px] justify-center px-0',
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
      <span className={cn(collapsed && 'hidden')}>{label}</span>
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
