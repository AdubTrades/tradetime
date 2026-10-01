import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { formatDuration } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { QuestionFields, toAnswerList, type AnswerValues } from '../../components/QuestionFields';
import { Button, cn } from '../../components/ui';
import { api, type Decision } from '../../lib/api';
import { decisionLabels, questionsFor, useQuestions } from '../../lib/checkins';
import { useSessionMutation } from '../../lib/sessions';

interface Props {
  sessionId: string | null;
  elapsedMinutes?: number;
  onClose: () => void;
}

/** Mid-session check-in: core questions, a decision, and what changed. Advice, never a block. */
export function CheckInDialog({ sessionId, elapsedMinutes, onClose }: Props) {
  const qc = useQueryClient();
  const { data: questions = [] } = useQuestions();
  const [values, setValues] = useState<AnswerValues>({});
  const [decision, setDecision] = useState<Decision | null>(null);
  const [stopTimer, setStopTimer] = useState(false);
  useEffect(() => {
    if (sessionId) {
      setValues({});
      setDecision(null);
      setStopTimer(false);
    }
  }, [sessionId]);

  const save = useSessionMutation(async () => {
    await api.post('/readings', { sessionId, kind: 'checkin', answers: toAnswerList(values), decision });
    if (stopTimer) await api.post(`/sessions/${sessionId}/stop`, {});
  });
  const submit = () =>
    save.mutate(undefined, {
      onSuccess: () => {
        for (const key of ['check-in-due', 'readings', 'trades', 'trade']) void qc.invalidateQueries({ queryKey: [key] });
        onClose();
      },
    });

  return (
    <Dialog
      open={!!sessionId}
      onClose={onClose}
      title={elapsedMinutes ? `Check in · ${formatDuration(elapsedMinutes)} on screen` : 'Check in'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!decision || save.isPending} onClick={submit}>
            Save check-in
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-muted">A quick pause to ask whether you should still be trading right now.</p>
        <QuestionFields questions={questionsFor(questions, 'checkin').filter((q) => q.kind !== 'text')} values={values} onChange={setValues} />
        <div className="space-y-1">
          <div className="text-sm font-medium">Decision</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(decisionLabels) as Decision[]).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={decision === d}
                onClick={() => {
                  setDecision(d);
                  setStopTimer(d === 'stop');
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  decision === d ? ('border-accent bg-accent text-accent-text') : 'border-border text-muted hover:text-text',
                )}
              >
                {decisionLabels[d]}
              </button>
            ))}
          </div>
          {decision && decision !== 'keep_trading' && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={stopTimer} onChange={(e) => setStopTimer(e.target.checked)} />
              Stop the session timer now
            </label>
          )}
        </div>
        <QuestionFields questions={questionsFor(questions, 'checkin').filter((q) => q.kind === 'text')} values={values} onChange={setValues} />
        {save.error && <p className="text-sm text-loss">{save.error.message}</p>}
      </div>
    </Dialog>
  );
}
