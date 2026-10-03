import { Link } from '@tanstack/react-router';
import { clsx, type ClassValue } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export { Select } from './Select';

/** Join class names, letting later Tailwind classes override earlier conflicting ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// ---------- Buttons ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'start';

// Primary is near-black; secondary is the white outline button; "start" is the one orange action.
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'border border-accent bg-accent text-accent-text hover:opacity-90',
  secondary: 'border border-border bg-card text-text shadow-card hover:bg-hover',
  ghost: 'border border-transparent text-muted hover:bg-hover hover:text-text',
  danger: 'border border-border bg-card text-loss shadow-card hover:bg-loss-tint',
  start: 'border border-ember bg-ember text-white hover:opacity-90',
};

export const buttonClass = (variant: ButtonVariant = 'secondary', size: 'md' | 'sm' = 'md') =>
  cn(
    'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition disabled:pointer-events-none disabled:opacity-40',
    size === 'md' ? 'h-10 rounded-md px-4 text-sm' : 'h-8 rounded-sm px-3 text-[13px]',
    buttonVariants[variant],
  );

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'md' | 'sm' }) {
  return <button type="button" className={cn(buttonClass(variant, size), className)} {...props} />;
}

/** Small outline "View all →" button that links to the related page. */
export function ViewLink({ to, children, search }: { to: string; children: ReactNode; search?: Record<string, unknown> }) {
  return (
    <Link to={to} search={search as never} className={cn(buttonClass('secondary', 'sm'), 'shrink-0 gap-1.5')}>
      {children} <ArrowRight size={13} aria-hidden />
    </Link>
  );
}

// ---------- Fields ----------

const fieldClass =
  'h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-text shadow-card placeholder:text-faint disabled:opacity-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-secondary">{label}</span>
      {children}
      {error ? <span className="block text-xs text-loss">{error}</span> : hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

// ---------- Cards ----------

/** Card header: title and muted description on the left, an action (usually a ViewLink) on the right. */
export function CardHeader({ title, description, action, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('card p-6', className)}>
      {(title || description || action) && <CardHeader title={title} description={description} action={action} />}
      {children}
    </section>
  );
}

/** Page title (32px/500) with a muted description, and actions on the right. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[32px] leading-[1.15]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** One card holding up to four stats in equal columns, split by thin dividers. */
export function SummaryStrip({ items, className }: { items: { label: ReactNode; value: ReactNode; sub?: ReactNode }[]; className?: string }) {
  return (
    <div className={cn('card grid grid-cols-2 sm:grid-cols-4', className)}>
      {items.map((it, i) => (
        <div
          key={i}
          className={cn(
            'min-w-0 px-6 py-4',
            i % 2 === 1 && 'border-l border-border-subtle',
            i >= 2 && 'border-t border-border-subtle sm:border-t-0',
            i >= 1 && 'sm:border-l sm:border-border-subtle',
          )}
        >
          <div className="text-[13px] text-muted">{it.label}</div>
          <div className="mt-1 truncate text-[22px] leading-tight font-medium tracking-tight">{it.value}</div>
          {it.sub && <div className="mt-0.5 text-xs text-muted">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ---------- Segmented tabs ----------

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  dark = false,
  label,
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  dark?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex rounded-md p-[3px]', dark ? 'gap-1 bg-dark-divider' : 'bg-tabs-track', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors',
              dark ? 'h-9 rounded-sm' : 'h-8 rounded-[7px]',
              active
                ? dark
                  ? 'bg-dark-text text-dark shadow-card'
                  : 'bg-card text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                : dark
                  ? 'text-dark-muted hover:text-dark-text'
                  : 'text-muted hover:text-text',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Pills ----------

/** Neutral outline pill for statuses and counts ("Manual", "Monthly", "4 criteria"). */
export function StatusPill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 text-xs whitespace-nowrap text-muted', className)}>{children}</span>;
}

const CATEGORY_TONES = ['internet', 'data', 'software', 'education', 'office', 'propfirm'] as const;
type CategoryTone = (typeof CATEGORY_TONES)[number];

/** Pick a category colour by keyword, falling back to a stable colour from the palette. */
export function categoryTone(name: string): CategoryTone {
  const n = name.toLowerCase();
  if (/internet|phone|mobile|nbn|broadband/.test(n)) return 'internet';
  if (/data|feed|market/.test(n)) return 'data';
  if (/software|charting|platform|subscription|app/.test(n)) return 'software';
  if (/educat|course|book|mentor|training/.test(n)) return 'education';
  if (/prop|evaluation|eval|funding|firm/.test(n)) return 'propfirm';
  if (/office|equipment|desk|hardware|computer|monitor/.test(n)) return 'office';
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CATEGORY_TONES[h % CATEGORY_TONES.length]!;
}

/** Soft tinted category pill (Expenses), no dot. */
export function CategoryPill({ name, className }: { name: string; className?: string }) {
  const tone = categoryTone(name);
  return (
    <span
      className={cn('inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', className)}
      style={{ background: `var(--cat-${tone}-bg)`, color: `var(--cat-${tone}-fg)` }}
    >
      {name}
    </span>
  );
}
