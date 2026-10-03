import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowLeft, ArrowUp, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { GRADES } from '@tc/domain';
import { FileDropTarget } from '../../components/FileDropTarget';
import { GradeBadge } from '../../components/GradeBadge';
import { Button, Card, Input, PageHeader, Select } from '../../components/ui';
import { api, type Attachment, type GradeRule, type PlayDetail, type PlayExample } from '../../lib/api';
import { useJournalMutation, usePlay } from '../../lib/journal';

export function PlayDetailPage({ playId }: { playId: string }) {
  const { data: play } = usePlay(playId);
  const update = useJournalMutation((patch: Partial<PlayDetail>) => api.patch(`/plays/${playId}`, patch));
  if (!play) return null;

  return (
    <div className="max-w-5xl space-y-6">
      <Link to="/playbook" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft size={14} aria-hidden /> Playbook
      </Link>
      <PageHeader
        title={play.title}
        actions={
          <Button variant="ghost" onClick={() => update.mutate({ archived: !play.archived })}>
            {play.archived ? 'Restore' : 'Archive'}
          </Button>
        }
      />
      <Card>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Title</span>
            <Input key={play.title} defaultValue={play.title} onBlur={(e) => e.target.value.trim() && e.target.value !== play.title && update.mutate({ title: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Description</span>
            <textarea
              key={play.description ?? ''}
              defaultValue={play.description ?? ''}
              rows={2}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
              placeholder="What this setup is and when it applies"
              onBlur={(e) => e.target.value !== (play.description ?? '') && update.mutate({ description: e.target.value || null })}
            />
          </label>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <CriteriaEditor play={play} />
        <GradeRulesEditor play={play} />
      </div>
      <Gallery play={play} />
    </div>
  );
}

function CriteriaEditor({ play }: { play: PlayDetail }) {
  const [label, setLabel] = useState('');
  const [mustHave, setMustHave] = useState(false);
  const add = useJournalMutation(() => api.post(`/plays/${play.id}/criteria`, { label, mustHave }));
  const patch = useJournalMutation(({ id, ...body }: { id: string; label?: string; mustHave?: boolean; archived?: boolean; sortOrder?: number }) =>
    api.patch(`/plays/criteria/${id}`, body),
  );
  const active = play.criteria.filter((c) => !c.archived);

  const move = (i: number, d: -1 | 1) => {
    const a = active[i];
    const b = active[i + d];
    if (!a || !b) return;
    patch.mutate({ id: a.id, sortOrder: b.sortOrder });
    patch.mutate({ id: b.id, sortOrder: a.sortOrder });
  };

  return (
    <Card title="Entry criteria" description="What must play out on the chart before you take this trade. Missing a must-have puts a trade outside the plan.">
      <ol className="space-y-1">
        {active.map((c, i) => (
          <li key={c.id} className="group flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-2">
            <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
            <Input
              key={c.label}
              defaultValue={c.label}
              aria-label="Criterion"
              className="border-transparent bg-transparent"
              onBlur={(e) => e.target.value.trim() && e.target.value !== c.label && patch.mutate({ id: c.id, label: e.target.value })}
            />
            <button
              type="button"
              onClick={() => patch.mutate({ id: c.id, mustHave: !c.mustHave })}
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${c.mustHave ? 'text-ember ring-1 ring-inset ring-ember' : 'bg-bg text-muted ring-1 ring-inset ring-text/10'}`}
              title="Toggle must-have"
            >
              {c.mustHave ? 'Must-have' : 'Standard'}
            </button>
            <span className="flex shrink-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              <Button variant="ghost" className="px-1.5" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={14} />
              </Button>
              <Button variant="ghost" className="px-1.5" aria-label="Move down" disabled={i === active.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={14} />
              </Button>
              <Button variant="ghost" className="px-1.5" aria-label="Remove criterion" onClick={() => patch.mutate({ id: c.id, archived: true })}>
                <Trash2 size={14} />
              </Button>
            </span>
          </li>
        ))}
        {active.length === 0 && <li className="px-1 py-2 text-sm text-muted">No criteria yet.</li>}
      </ol>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim())
            add.mutate(undefined, {
              onSuccess: () => {
                setLabel('');
                setMustHave(false);
              },
            });
        }}
      >
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Price reclaims VWAP" className="min-w-48 flex-1" />
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={mustHave} onChange={(e) => setMustHave(e.target.checked)} /> Must-have
        </label>
        <Button type="submit" disabled={!label.trim()}>
          <Plus size={16} aria-hidden /> Add
        </Button>
      </form>
      <p className="mt-3 text-xs text-muted">Removed criteria stay on past trades exactly as they were logged.</p>
    </Card>
  );
}

function GradeRulesEditor({ play }: { play: PlayDetail }) {
  const [rules, setRules] = useState<GradeRule[]>(play.gradeRules);
  useEffect(() => setRules(play.gradeRules), [play.gradeRules]);
  const save = useJournalMutation((gradeRules: GradeRule[]) => api.patch(`/plays/${play.id}`, { gradeRules }));
  const standardCount = play.criteria.filter((c) => !c.archived && !c.mustHave).length;
  const dirty = JSON.stringify(rules) !== JSON.stringify(play.gradeRules);
  const setRule = (grade: string, patch: Partial<GradeRule>) => setRules((rs) => rs.map((r) => (r.grade === grade ? { ...r, ...patch } : r)));

  return (
    <Card
      title="Grading"
      description={`How many standard criteria (of ${standardCount}) can be missed for each grade. Your risk rule per grade is shown next to the stats as a reference.`}
    >
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="pb-2 font-medium">Grade</th>
            <th className="pb-2 font-medium">Max missed</th>
            <th className="pb-2 font-medium">Your risk rule</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.grade}>
              <td className="py-1 pr-3">
                <GradeBadge grade={r.grade} />
              </td>
              <td className="py-1 pr-3">
                <Input
                  type="number"
                  min={0}
                  className="w-20"
                  value={r.maxMissed}
                  onChange={(e) => setRule(r.grade, { maxMissed: Math.max(0, Number(e.target.value) || 0) })}
                />
              </td>
              <td className="py-1">
                <Input value={r.riskNote ?? ''} onChange={(e) => setRule(r.grade, { riskNote: e.target.value || null })} placeholder="e.g. Full risk" />
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-1 pr-3">
              <GradeBadge grade="C" />
            </td>
            <td className="py-1 pr-3 text-muted" colSpan={2}>
              Anything more
            </td>
          </tr>
        </tbody>
      </table>
      {save.error && <p className="mt-2 text-sm text-loss">{save.error.message}</p>}
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRules(play.gradeRules)}>
            Reset
          </Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(rules)}>
            Save grading
          </Button>
        </div>
      )}
    </Card>
  );
}

function Gallery({ play }: { play: PlayDetail }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base">Gallery</h2>
        <p className="text-sm text-muted">What each grade of this setup looks like. A+ is your ideal-example shelf. Drop or paste screenshots onto a shelf.</p>
      </div>
      {GRADES.map((g) => (
        <GradeShelf key={g} play={play} grade={g} examples={play.examples.filter((e) => e.grade === g)} />
      ))}
    </section>
  );
}

function GradeShelf({ play, grade, examples }: { play: PlayDetail; grade: string; examples: PlayExample[] }) {
  const upload = useJournalMutation(async (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('file', f);
    const uploaded = await api.post<{ attachment: Attachment }[]>('/attachments', form);
    for (const { attachment } of uploaded) await api.post(`/plays/${play.id}/examples`, { grade, attachmentId: attachment.id, date: DateTime.now().toISODate() });
  });
  const updateEx = useJournalMutation(({ id, ...patch }: { id: string; caption?: string | null; grade?: string }) => api.patch(`/plays/examples/${id}`, patch));
  const remove = useJournalMutation((id: string) => api.delete(`/plays/examples/${id}`));

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <GradeBadge grade={grade} className="text-sm" />
        <span className="text-xs text-muted">{examples.length} examples</span>
        {play.gradeRules.find((r) => r.grade === grade)?.riskNote && (
          <span className="text-xs text-muted">· {play.gradeRules.find((r) => r.grade === grade)?.riskNote}</span>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {examples.map((ex) => (
          <figure key={ex.id} className="group overflow-hidden rounded-md border border-border bg-surface-2">
            <a href={`/api/attachments/${ex.attachmentId}/file`} target="_blank" rel="noreferrer" className="block aspect-video bg-black/5">
              {ex.mime.startsWith('image/') ? (
                <img src={`/api/attachments/${ex.attachmentId}/file`} alt={ex.caption ?? `${grade} example`} className="h-full w-full object-contain" />
              ) : (
                <span className="flex h-full items-center justify-center text-xs text-muted">PDF</span>
              )}
            </a>
            <figcaption className="space-y-1 p-2 text-xs">
              <input
                key={ex.caption ?? ''}
                defaultValue={ex.caption ?? ''}
                placeholder="Add a caption"
                className="w-full bg-transparent text-sm"
                onBlur={(e) => e.target.value !== (ex.caption ?? '') && updateEx.mutate({ id: ex.id, caption: e.target.value || null })}
              />
              <div className="flex items-center gap-2 text-muted">
                {ex.date && <span>{DateTime.fromISO(ex.date).toFormat('d LLL yyyy')}</span>}
                {ex.resultLabel && <span>· {ex.resultLabel}</span>}
                {ex.sourceTradeId && (
                  <Link to="/journal/trades/$tradeId" params={{ tradeId: ex.sourceTradeId }} className="hover:text-text">
                    · trade
                  </Link>
                )}
                <Select aria-label="Move to grade" size="sm" className="ml-auto w-20" value={ex.grade} onChange={(e) => updateEx.mutate({ id: ex.id, grade: e.target.value })}>
                  {GRADES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </Select>
                <button
                  type="button"
                  aria-label="Remove example"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-loss"
                  onClick={() => window.confirm('Remove this example from the gallery?') && remove.mutate(ex.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </figcaption>
          </figure>
        ))}
        <FileDropTarget
          onFiles={(files) => upload.mutate(files)}
          accept="image/png,image/jpeg,image/webp,image/gif,image/heic"
          label={`Add ${grade} example`}
          className="flex aspect-video flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border text-xs text-muted hover:border-muted"
          activeClassName="border-ember bg-ember/5"
        >
          <ImagePlus size={18} aria-hidden />
          {upload.isPending ? 'Uploading…' : `Add ${grade} example`}
        </FileDropTarget>
      </div>
      {upload.error && <p className="mt-2 text-sm text-loss">{upload.error.message}</p>}
    </div>
  );
}
