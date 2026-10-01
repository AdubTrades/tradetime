import { Link, useNavigate } from '@tanstack/react-router';
import { Images, ListChecks, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, PageHeader } from '../../components/ui';
import { api, type Play } from '../../lib/api';
import { useJournalMutation, usePlays } from '../../lib/journal';

export function PlaybookPage() {
  const { data: plays = [], isLoading } = usePlays();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const create = useJournalMutation((title: string) => api.post<Play>('/plays', { title }));
  const visible = plays.filter((p) => showArchived || !p.archived);

  const addPlay = () => {
    const title = window.prompt('Name of the Play (entry model)')?.trim();
    if (title) create.mutate(title, { onSuccess: (p) => navigate({ to: '/playbook/$playId', params: { playId: p.id } }) });
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Playbook"
        actions={
          <>
            {plays.some((p) => p.archived) && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
              </label>
            )}
            <Button variant="primary" onClick={addPlay}>
              <Plus size={16} aria-hidden /> New Play
            </Button>
          </>
        }
      />
      {!isLoading && visible.length === 0 && (
        <div className="panel p-10 text-center text-sm text-muted">
          No Plays yet. Add your first entry model, list the criteria that must play out before you take it, and build a gallery of what each grade looks
          like.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((p) => {
          const active = p.criteria.filter((c) => !c.archived);
          return (
            <Link
              key={p.id}
              to="/playbook/$playId"
              params={{ playId: p.id }}
              className={`block panel p-5 transition hover:bg-ivory ${p.archived ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="">{p.title}</h2>
                {p.archived && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">Archived</span>}
              </div>
              {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{p.description}</p>}
              <div className="mt-3 flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1">
                  <ListChecks size={14} aria-hidden /> {active.length} criteria ({active.filter((c) => c.mustHave).length} must-have)
                </span>
                <span className="flex items-center gap-1">
                  <Images size={14} aria-hidden /> {p.exampleCount} examples
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
