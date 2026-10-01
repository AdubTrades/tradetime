import { Link, Outlet } from '@tanstack/react-router';
import { BookOpen, CalendarDays, Monitor, Moon, Receipt, Settings as SettingsIcon, Sun, Target, Timer } from 'lucide-react';
import type { Theme } from '../lib/api';
import { useSettings, useUpdateSettings } from '../lib/settings';
import { useThemeSync } from '../lib/theme';

const nav = [
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

const linkClass =
  'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-text [&.active]:bg-surface-2 [&.active]:font-medium [&.active]:text-text';

export function AppShell() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  useThemeSync(settings?.theme);
  const theme = themeCycle[settings?.theme ?? 'system'];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-4">
        <div className="mb-6 px-3 text-sm font-semibold tracking-tight">Trading Companion</div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={linkClass}>
              <Icon size={18} aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <Link to="/settings" className={linkClass}>
            <SettingsIcon size={18} aria-hidden />
            Settings
          </Link>
          <button
            type="button"
            className={linkClass}
            onClick={() => updateSettings.mutate({ theme: theme.next })}
            title="Switch theme"
          >
            <theme.icon size={18} aria-hidden />
            {theme.label}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
