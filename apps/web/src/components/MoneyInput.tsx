import { useEffect, useState } from 'react';
import { parseMoney } from '@tc/domain';
import { cn, Input } from './ui';

interface Props {
  /** Value in cents, or null when empty. */
  value: number | null;
  onChange: (cents: number | null) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  prefix?: string;
}

const display = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));

/** Text input for dollar amounts that reports integer cents. Invalid text is flagged and reported as null. */
export function MoneyInput({ value, onChange, prefix = '$', className, ...rest }: Props) {
  const [text, setText] = useState(display(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    // Sync when the value changes from outside (e.g. form reset), but don't clobber what's being typed.
    setText((current) => {
      try {
        return current.trim() && parseMoney(current) === value ? current : display(value);
      } catch {
        return display(value);
      }
    });
  }, [value]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted">{prefix}</span>
      <Input
        {...rest}
        inputMode="decimal"
        value={text}
        className={cn('tabular pl-6 text-right', invalid && 'outline-2 outline-loss', className)}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setInvalid(false);
            onChange(null);
            return;
          }
          try {
            onChange(parseMoney(e.target.value));
            setInvalid(false);
          } catch {
            setInvalid(true);
            onChange(null);
          }
        }}
        onBlur={() => !invalid && setText(display(value))}
      />
    </div>
  );
}
