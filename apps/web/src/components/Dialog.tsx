import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

/**
 * Modal built on the native <dialog> element (focus trap, Esc to close, backdrop). On phones it fills the screen
 * as a sheet, with the header and footer clear of the notch and home indicator.
 */
export function Dialog({ open, onClose, title, children, footer, width = 'max-w-lg' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-lg border border-border bg-card p-0 text-text shadow-menu backdrop:bg-[#1c1c1c]/40 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col max-sm:h-full max-sm:max-h-none">
          <header className="flex items-center justify-between border-b border-border px-6 py-4 max-sm:px-4 max-sm:pt-[calc(1rem+env(safe-area-inset-top))]">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="-mr-1.5 flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text" aria-label="Close">
              <X size={18} />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-5 max-sm:px-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-border bg-inset px-6 py-3 max-sm:px-4 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
