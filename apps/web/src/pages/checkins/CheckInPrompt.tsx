import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, X } from 'lucide-react';
import { useState } from 'react';
import { formatDuration } from '@tc/domain';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useDueCheckIn } from '../../lib/checkins';
import { useSettings } from '../../lib/settings';
import { CheckInDialog } from './CheckInDialog';

/** Floating, hard-to-miss card when a check-in is due. Easy to snooze or dismiss. Lives in the app shell. */
export function CheckInPrompt() {
  const qc = useQueryClient();
  const { data: due } = useDueCheckIn();
  const { data: settings } = useSettings();
  const [open, setOpen] = useState(false);
  const act = useMutation({
    mutationFn: (action: 'snooze' | 'dismiss') => api.post(`/check-ins/${due!.sessionId}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['check-in-due'] }),
  });

  return (
    <>
      {due && !open && (
        <div role="alertdialog" aria-label="Time to check in" className="fixed right-6 bottom-6 z-40 w-80 rounded-lg border border-ember bg-bg p-5">
          <div className="flex items-start gap-3">
            <BellRing className="mt-0.5 shrink-0 text-ember" size={20} aria-hidden />
            <div className="flex-1">
              <div className="font-display text-lg leading-tight">Time to check in</div>
              <div className="text-sm text-muted">{formatDuration(due.elapsedMinutes)} on screen this session. Should you still be trading?</div>
            </div>
            <button type="button" aria-label="Dismiss" className="text-muted hover:text-text" onClick={() => act.mutate('dismiss')}>
              <X size={16} />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" className="flex-1" onClick={() => setOpen(true)}>
              Check in
            </Button>
            <Button onClick={() => act.mutate('snooze')}>Snooze {settings?.checkInSnoozeMinutes ?? 15}m</Button>
          </div>
        </div>
      )}
      <CheckInDialog sessionId={open && due ? due.sessionId : null} elapsedMinutes={due?.elapsedMinutes} onClose={() => setOpen(false)} />
    </>
  );
}
