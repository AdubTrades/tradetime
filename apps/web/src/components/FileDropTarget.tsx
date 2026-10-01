import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './ui';

export const ACCEPT_ATTACHMENTS = 'image/png,image/jpeg,image/webp,image/gif,image/heic,application/pdf';

interface Props {
  onFiles: (files: File[]) => void;
  /** Listen for ⌘V anywhere on the page, not just when this target has focus. */
  pasteAnywhere?: boolean;
  accept?: string;
  className?: string;
  activeClassName?: string;
  label: string;
  children: ReactNode;
}

/** Click, drop or paste files. Renders its children inside a focusable drop area. */
export function FileDropTarget({ onFiles, pasteAnywhere = false, accept = ACCEPT_ATTACHMENTS, className, activeClassName, label, children }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    const target: HTMLElement | Window | null = pasteAnywhere ? window : zoneRef.current;
    if (!target) return;
    const onPaste = (e: Event) => {
      const files = (e as ClipboardEvent).clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        onFilesRef.current(Array.from(files));
      }
    };
    target.addEventListener('paste', onPaste);
    return () => target.removeEventListener('paste', onPaste);
  }, [pasteAnywhere]);

  return (
    <div
      ref={zoneRef}
      tabIndex={0}
      role="button"
      aria-label={label}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn('cursor-pointer focus:outline-2 focus:outline-accent', className, dragging && activeClassName)}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
    </div>
  );
}
