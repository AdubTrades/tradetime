import { RotateCcw, LogOut } from 'lucide-react';
import { useHealth } from '../lib/demo';

/** Shown across the top of the demo copy, with ways back to the real app. */
export function DemoBanner() {
  const { data } = useHealth();
  if (!data?.demo) return null;
  const real = data.realAppUrl;
  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-1 bg-text px-6 py-2 text-sm text-bg">
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-ember" aria-hidden />
        <span className="font-display">Demo mode</span>
      </span>
      <span className="opacity-75">Sample data for Alex Morgan, a fictional trader. Nothing here is real, and changes only affect the demo.</span>
      {real && (
        <span className="ml-auto flex items-center gap-4">
          <a href={`${real}/demo-switch?action=reset`} className="inline-flex items-center gap-1.5 opacity-80 hover:opacity-100">
            <RotateCcw size={14} aria-hidden /> Reset demo
          </a>
          <a href={`${real}/demo-switch?action=exit`} className="inline-flex items-center gap-1.5 underline decoration-ember underline-offset-4">
            <LogOut size={14} aria-hidden /> Exit demo
          </a>
        </span>
      )}
    </div>
  );
}
