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

/** Modal built on the native <dialog> element (focus trap, Esc to close, backdrop). */
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
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-[6px_0_0_0] border border-border bg-bg p-0 text-text backdrop:bg-[#202020]/45`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-xl">{title}</h2>
            <button type="button" onClick={onClose} className="p-1 text-muted hover:bg-surface hover:text-text" aria-label="Close">
              <X size={18} />
            </button>
          </header>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-border bg-surface-2 px-6 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
