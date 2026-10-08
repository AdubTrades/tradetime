import { useEffect, useState } from 'react';

/**
 * Installing TradeTime as an app (home screen / dock). Chrome, Edge and Android offer an install prompt the page can
 * trigger; Safari on iPhone and iPad needs Share → Add to Home Screen. Notifications on iPhone only work once installed.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((l) => l());
});

export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export type InstallState = 'installed' | 'prompt' | 'ios' | 'unavailable';

export function useInstall(): { state: InstallState; install: () => Promise<void> } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const state: InstallState = isInstalled() ? 'installed' : deferred ? 'prompt' : isIos() ? 'ios' : 'unavailable';
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    force((n) => n + 1);
  };
  return { state, install };
}
