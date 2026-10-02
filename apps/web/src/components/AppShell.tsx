import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { ErrorBoundary } from './ErrorBoundary';
import { BookOpen, CalendarDays, House, Monitor, Moon, Receipt, Settings as SettingsIcon, Sun, Target, Timer } from 'lucide-react';
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

// Pill-shaped nav items; the active page sits in an Ash capsule with a small Ember marker.
const linkClass =
  'font-display group relative flex items-center gap-3 rounded-full px-4 py-2 text-[15px] text-muted transition hover:text-text [&.active]:bg-surface [&.active]:text-text';

export function AppShell() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  useThemeSync(settings?.theme);
  const theme = themeCycle[settings?.theme ?? 'system'];
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-bg px-4 py-6">
        <Link to="/home" className="mb-10 px-4" aria-label="TradeTime home">
          <Wordmark />
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={linkClass}>
              <Icon size={17} strokeWidth={1.6} aria-hidden />
              {label}
              <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-ember group-[.active]:block" aria-hidden />
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <Link to="/settings" className={linkClass}>
            <SettingsIcon size={17} strokeWidth={1.6} aria-hidden />
            Settings
          </Link>
          <button
            type="button"
            className={linkClass}
            onClick={() => updateSettings.mutate({ theme: theme.next })}
            title="Switch theme"
          >
            <theme.icon size={17} strokeWidth={1.6} aria-hidden />
            {theme.label}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-10 py-10">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <CheckInPrompt />
    </div>
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
