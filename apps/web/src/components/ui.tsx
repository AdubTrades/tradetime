import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** Join class names, letting later Tailwind classes override earlier conflicting ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

// Square-cornered buttons in two dialects: filled graphite for the main action, outlined for the rest.
// Ember is never a button fill; destructive actions are outlined in the loss colour.
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'border border-accent bg-accent text-accent-text hover:opacity-85',
  secondary: 'border border-text/80 bg-transparent text-text hover:bg-surface',
  ghost: 'border border-transparent text-muted hover:text-text hover:bg-surface',
  danger: 'border border-loss bg-transparent text-loss hover:bg-loss/10',
};

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={cn(
        'font-display inline-flex items-center justify-center gap-2 rounded-none px-3.5 py-1.5 text-sm leading-tight transition',
        'disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember',
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

// Fields are white with a hairline, sharp-cornered like the buttons, so they read clearly on Ash panels.
const fieldClass =
  'w-full rounded-none border border-text/15 bg-bg px-2.5 py-1.5 text-sm text-text placeholder:text-muted/70 focus:border-text/40 focus:outline-2 focus:outline-offset-0 focus:outline-ember/60';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldClass, className)} {...props} />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[13px] font-medium text-text/85">{label}</span>
      {children}
      {error ? <span className="block text-xs text-loss">{error}</span> : hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ title, description, children, className }: { title?: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('panel p-6', className)}>
      {title && <h2 className="text-lg">{title}</h2>}
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className={cn(title || description ? 'mt-4' : undefined)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-[32px] leading-[1.19]">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
