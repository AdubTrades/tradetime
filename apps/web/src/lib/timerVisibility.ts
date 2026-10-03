import { useEffect, useSyncExternalStore, type RefObject } from 'react';

// How many full-size session timers are currently on screen. The floating mini timer hides while any are.
let visible = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Report whether this full-size timer is in the viewport. */
export function useReportTimerVisible(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let shown = false;
    const set = (next: boolean) => {
      if (next === shown) return;
      shown = next;
      visible += next ? 1 : -1;
      emit();
    };
    const io = new IntersectionObserver(([entry]) => set(!!entry?.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => {
      io.disconnect();
      set(false);
    };
  }, [ref]);
}

/** True while a full-size timer is visible on the page. */
export function useFullTimerVisible(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => visible > 0,
  );
}
