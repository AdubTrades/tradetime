import type { Dispatch, SetStateAction } from 'react';
import type { Question } from '../lib/api';
import { useList } from '../lib/expenses';
import { cn, Select } from './ui';

export type AnswerValues = Record<string, string | number | null>;

/** Renders the answer control for each question kind. */
export function QuestionFields({
  questions,
  values,
  onChange,
}: {
  questions: Question[];
  values: AnswerValues;
  /** A state setter: updates are applied to the latest values, so quick successive clicks never drop answers. */
  onChange: Dispatch<SetStateAction<AnswerValues>>;
}) {
  const { data: moods = [] } = useList('mood');
  const set = (id: string, v: string | number | null) => onChange((prev) => ({ ...prev, [id]: v }));

  return (
    <div className="space-y-4">
      {questions.map((q) => (
        <div key={q.id} className="space-y-1">
          <div className="text-sm font-medium">{q.prompt}</div>
          {q.kind === 'mood' && (
            <div className="flex flex-wrap gap-1.5">
              {moods
                .filter((m) => !m.archived)
                .map((m) => (
                  <Chip key={m.id} on={values[q.id] === m.id} onClick={() => set(q.id, values[q.id] === m.id ? null : m.id)}>
                    {m.name}
                  </Chip>
                ))}
              {moods.length === 0 && (
                <Select value="" disabled>
                  <option>Add moods in Settings</option>
                </Select>
              )}
            </div>
          )}
          {q.kind === 'scale' && (
            <div className="flex items-center gap-1">
              <span className="mr-1 text-xs text-muted">Low</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <Chip key={n} on={values[q.id] === n} onClick={() => set(q.id, values[q.id] === n ? null : n)} square>
                  {n}
                </Chip>
              ))}
              <span className="ml-1 text-xs text-muted">High</span>
            </div>
          )}
          {q.kind === 'yesPartlyNo' && (
            <div className="flex gap-1.5">
              {(['yes', 'partly', 'no'] as const).map((v) => (
                <Chip key={v} on={values[q.id] === v} onClick={() => set(q.id, values[q.id] === v ? null : v)}>
                  {v[0]!.toUpperCase() + v.slice(1)}
                </Chip>
              ))}
            </div>
          )}
          {q.kind === 'text' && (
            <textarea
              rows={2}
              value={(values[q.id] as string | null) ?? ''}
              onChange={(e) => set(q.id, e.target.value || null)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-2 focus:outline-ember"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Chip({ on, onClick, children, square }: { on: boolean; onClick: () => void; children: React.ReactNode; square?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border text-sm transition',
        square ? 'h-8 w-8 rounded-md' : 'px-3 py-1',
        on ? 'border-accent bg-accent text-accent-text' : 'border-border text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

export const toAnswerList = (values: AnswerValues) => Object.entries(values).map(([questionId, value]) => ({ questionId, value }));
