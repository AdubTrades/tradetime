import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Field, Input, Select } from '../../components/ui';
import { api, type Question, type QuestionKind, type Settings } from '../../lib/api';
import { useQuestions } from '../../lib/checkins';
import { useUpdateSettings } from '../../lib/settings';

const kindLabels: Record<QuestionKind, string> = { mood: 'Mood (from your list)', scale: 'Scale 1–5', yesPartlyNo: 'Yes / partly / no', text: 'Free text' };
const appliesLabels: Record<Question['appliesTo'], string> = { both: 'Start and check-ins', start: 'Session start only', checkin: 'Check-ins only' };
const minuteOptions = [30, 45, 60, 75, 90, 120, 150, 180, 240];

export function CheckInSettings({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  return (
    <Card
      title="Session start and check-ins"
      description="Trading sessions open a short checklist when you press Start. After a set amount of screen time you get a check-in prompt — advice, not a block."
    >
      <div className="space-y-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.checkInEnabled} onChange={(e) => update.mutate({ checkInEnabled: e.target.checked })} />
          Prompt me to check in during trading sessions
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="First check-in after">
            <Select disabled={!settings.checkInEnabled} value={settings.checkInMinutes} onChange={(e) => update.mutate({ checkInMinutes: Number(e.target.value) })}>
              {minuteOptions.map((m) => (
                <option key={m} value={m}>
                  {m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`} on screen
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Second check-in after" hint="Optional">
            <Select
              disabled={!settings.checkInEnabled}
              value={settings.checkInSecondMinutes ?? ''}
              onChange={(e) => update.mutate({ checkInSecondMinutes: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">None</option>
              {minuteOptions
                .filter((m) => m > settings.checkInMinutes)
                .map((m) => (
                  <option key={m} value={m}>
                    {m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`} on screen
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Snooze for">
            <Select disabled={!settings.checkInEnabled} value={settings.checkInSnoozeMinutes} onChange={(e) => update.mutate({ checkInSnoozeMinutes: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {update.error && <p className="text-sm text-loss">{update.error.message}</p>}
        <QuestionsEditor />
      </div>
    </Card>
  );
}

function QuestionsEditor() {
  const qc = useQueryClient();
  const { data: questions = [] } = useQuestions();
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<QuestionKind>('scale');
  const [appliesTo, setAppliesTo] = useState<Question['appliesTo']>('both');
  const refresh = () => qc.invalidateQueries({ queryKey: ['questions'] });
  const patch = useMutation({ mutationFn: ({ id, ...b }: Partial<Question> & { id: string }) => api.patch(`/questions/${id}`, b), onSettled: refresh });
  const create = useMutation({
    mutationFn: () => api.post('/questions', { prompt, kind, appliesTo }),
    onSuccess: () => {
      setPrompt('');
      void refresh();
    },
  });
  const active = questions.filter((q) => !q.archived);
  const move = (i: number, d: -1 | 1) => {
    const a = active[i];
    const b = active[i + d];
    if (!a || !b) return;
    patch.mutate({ id: a.id, sortOrder: b.sortOrder });
    patch.mutate({ id: b.id, sortOrder: a.sortOrder });
  };

  return (
    <div>
      <div className="mb-1 text-sm font-medium">Questions</div>
      <p className="mb-2 text-xs text-muted">
        Questions used for both line up one-to-one, so you can compare session start with each check-in. Past answers keep the wording they were given
        with. The check-in decision (keep trading / break / stop) is always asked.
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {active.map((q, i) => (
          <li key={q.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
            <Input
              key={q.prompt}
              defaultValue={q.prompt}
              aria-label="Question"
              className="min-w-48 flex-1 border-transparent bg-transparent"
              onBlur={(e) => e.target.value.trim() && e.target.value !== q.prompt && patch.mutate({ id: q.id, prompt: e.target.value })}
            />
            <span className="w-36 text-xs text-muted">{kindLabels[q.kind]}</span>
            <Select aria-label="Asked at" className="w-44" value={q.appliesTo} onChange={(e) => patch.mutate({ id: q.id, appliesTo: e.target.value as Question['appliesTo'] })}>
              {Object.entries(appliesLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <Button variant="ghost" className="px-1.5" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={14} />
            </Button>
            <Button variant="ghost" className="px-1.5" aria-label="Move down" disabled={i === active.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={14} />
            </Button>
            <Button variant="ghost" className="text-xs" onClick={() => patch.mutate({ id: q.id, archived: true })}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) create.mutate();
        }}
      >
        <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="New question, e.g. Sleep quality" className="min-w-48 flex-1" />
        <Select aria-label="Answer type" className="w-44" value={kind} onChange={(e) => setKind(e.target.value as QuestionKind)}>
          {Object.entries(kindLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select aria-label="Asked at" className="w-44" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as Question['appliesTo'])}>
          {Object.entries(appliesLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={!prompt.trim()}>
          <Plus size={16} aria-hidden /> Add
        </Button>
      </form>
      {questions.some((q) => q.archived) && (
        <p className="mt-2 text-xs text-muted">
          Removed:{' '}
          {questions
            .filter((q) => q.archived)
            .map((q) => (
              <button key={q.id} type="button" className="mr-2 underline hover:text-text" onClick={() => patch.mutate({ id: q.id, archived: false })}>
                {q.prompt}
              </button>
            ))}
        </p>
      )}
      {(patch.error || create.error) && <p className="mt-1 text-xs text-loss">{(patch.error ?? create.error)?.message}</p>}
    </div>
  );
}
