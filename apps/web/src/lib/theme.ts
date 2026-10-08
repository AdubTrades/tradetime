import { useEffect } from 'react';
import type { Theme } from './api';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
  // The browser / installed-app title bar follows the chosen theme, not just the system one.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute('media');
    m.content = dark ? '#121211' : '#f6f5f3';
  });
  try {
    localStorage.setItem('tc-theme', theme);
  } catch {
    // Storage unavailable; theme still applies for this page load.
  }
}

/** Keep the document theme in sync with the setting and, for "system", with the OS. */
export function useThemeSync(theme: Theme | undefined): void {
  useEffect(() => {
    if (!theme) return;
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = media();
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
}

/** A user-chosen type colour for display. Graphite follows the text colour so it stays visible in dark mode. */
export const swatch = (color: string | null | undefined): string | undefined =>
  !color ? undefined : color.toLowerCase() === '#202020' ? 'var(--text)' : color;
