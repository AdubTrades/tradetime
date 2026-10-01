import { BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { QuestionFields, toAnswerList, type AnswerValues } from '../../components/QuestionFields';
import { Button } from '../../components/ui';
import { api, type Session, type SessionType } from '../../lib/api';
import { questionsFor, useQuestions } from '../../lib/checkins';
import { useSessionMutation } from '../../lib/sessions';

/** Session-start checklist for trading sessions: the same core questions as check-ins, plus start-only ones. */
export function SessionStartDialog({ type, open, onClose }: { type: SessionType | null; open: boolean; onClose: () => void }) {
  const { data: questions = [] } = useQuestions();
  const [values, setValues] = useState<AnswerValues>({});
  useEffect(() => {
    if (open) setValues({});
  }, [open]);
  const start = useSessionMutation((withAnswers: boolean) =>
    api.post<Session>('/sessions/start', { typeId: type!.id, ...(withAnswers ? { startAnswers: toAnswerList(values) } : {}) }),
  );
  const go = (withAnswers: boolean) => start.mutate(withAnswers, { onSuccess: onClose });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Start ${type?.name.toLowerCase() ?? 'session'}`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={start.isPending} onClick={() => go(false)}>
            Skip checklist
          </Button>
          <Button variant="primary" disabled={start.isPending} onClick={() => go(true)}>
            Start session
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 p-3 text-sm">
          <span className="text-muted">Take a minute to review your ideal setups before trading.</span>
          <a href="/playbook" target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1.5 font-medium text-ember hover:underline">
            <BookOpen size={16} aria-hidden /> Open Playbook
          </a>
        </div>
        <QuestionFields questions={questionsFor(questions, 'start')} values={values} onChange={setValues} />
        <p className="text-xs text-muted">The timer starts when you press Start session. Your answers become this session's baseline for check-ins.</p>
        {start.error && <p className="text-sm text-loss">{start.error.message}</p>}
      </div>
    </Dialog>
  );
}
