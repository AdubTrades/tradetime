import { useEffect } from 'react';
import type { Theme } from './api';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
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
