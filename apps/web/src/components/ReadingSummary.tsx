import type { ReadingAnswer, StateReading } from '../lib/api';
import { decisionLabels } from '../lib/checkins';
import { cn } from './ui';

/** Compact chips for a reading's non-text answers, e.g. "Focused · Focus 4 · Plan: partly". */
export function ReadingChips({ answers, decision, className }: { answers: ReadingAnswer[]; decision?: StateReading['decision']; className?: string }) {
  const chips = answers
    .filter((a) => a.value !== null && a.kind !== 'text')
    .map((a) => (a.kind === 'mood' ? (a.label ?? '?') : a.kind === 'scale' ? `${a.prompt} ${a.value}` : `${a.prompt.replace(/\?$/, '')}: ${a.value}`));
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {chips.map((c, i) => (
        <span key={i} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
          {c}
        </span>
      ))}
      {decision && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">{decisionLabels[decision]}</span>}
      {chips.length === 0 && !decision && <span className="text-xs text-muted">No answers</span>}
    </span>
  );
}

/** Free-text answers as "Prompt: text" lines. */
export function ReadingNotes({ answers }: { answers: ReadingAnswer[] }) {
  const notes = answers.filter((a) => a.kind === 'text' && a.value);
  if (notes.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {notes.map((a) => (
        <p key={a.questionId}>
          <span className="text-muted">{/[?:]$/.test(a.prompt) ? a.prompt : `${a.prompt}:`}</span> {a.value}
        </p>
      ))}
    </div>
  );
}
