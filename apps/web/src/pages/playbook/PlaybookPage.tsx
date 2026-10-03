import { Link, useNavigate } from '@tanstack/react-router';
import { ImageIcon, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { stats } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { Pnl } from '../../components/GradeBadge';
import { Button, cn, Field, Input, PageHeader, StatusPill } from '../../components/ui';
import { api, type Play } from '../../lib/api';
import { useJournalMutation, usePlays, useTrades } from '../../lib/journal';

export function PlaybookPage() {
  const { data: plays = [], isLoading } = usePlays();
  // Per-play stats use every journal trade, not just a recent window.
  const { data: trades = [] } = useTrades('2000-01-01', '2100-12-31');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const visible = plays.filter((p) => showArchived || !p.archived);

  const byPlay = useMemo(() => {
    const map = new Map<string, stats.Summary>();
    for (const p of plays) map.set(p.id, stats.summarise(trades.filter((t) => t.playId === p.id)));
    return map;
  }, [plays, trades]);
  const firstDay = useMemo(() => trades.reduce<string | null>((min, t) => (!min || t.tradingDay < min ? t.tradingDay : min), null), [trades]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Playbook"
        description="The setups you trade, the rules that make them valid, and how they’re going."
        actions={
          <>
            {plays.some((p) => p.archived) && (
              <label className="flex min-h-10 items-center gap-2 text-sm text-secondary">
                <input type="checkbox" className="h-4 w-4 accent-[var(--text)]" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show
                archived
              </label>
            )}
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={14} aria-hidden /> New play
            </Button>
          </>
        }
      />
      <div className="-mt-6 grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-5">
        {visible.map((p) => (
          <PlayCard key={p.id} play={p} summary={byPlay.get(p.id)} />
        ))}
        {!isLoading && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-80 flex-col items-center justify-center gap-2.5 rounded-lg border-[1.5px] border-dashed border-border-strong/60 px-6 text-sm font-medium text-secondary transition-colors hover:border-border-strong hover:bg-card"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-text shadow-card">
              <Plus size={16} aria-hidden />
            </span>
            Add a play
            <span className="max-w-[220px] text-[13px] leading-normal font-normal text-muted">Name the setup, list its criteria and mark the must-haves.</span>
          </button>
        )}
      </div>
      {firstDay && <p className="text-[13px] text-muted">Stats cover trades logged since {DateTime.fromISO(firstDay).toFormat('d LLLL yyyy')}.</p>}
      <NewPlayDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function PlayCard({ play: p, summary: s }: { play: Play; summary?: stats.Summary }) {
  const active = p.criteria.filter((c) => !c.archived);
  const mustHave = active.filter((c) => c.mustHave).length;
  return (
    <Link
      to="/playbook/$playId"
      params={{ playId: p.id }}
      className={cn(
        'card flex flex-col overflow-hidden transition-[border-color,box-shadow] hover:border-border-strong/70 hover:shadow-menu',
        p.archived && 'opacity-60',
      )}
    >
      <Collage ids={p.coverAttachmentIds} total={p.exampleCount} />
      <div className="flex flex-1 flex-col gap-3.5 px-5 pt-[18px] pb-5">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-base font-semibold tracking-[-0.015em]">{p.title}</h2>
            {p.archived && <StatusPill>Archived</StatusPill>}
          </div>
          {p.description && <p className="mt-1.5 line-clamp-3 text-sm leading-normal text-secondary">{p.description}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill>{active.length} criteria</Pill>
          {mustHave > 0 && <Pill tone="must">{mustHave} must-have</Pill>}
          <Pill>
            {p.exampleCount} example{p.exampleCount === 1 ? '' : 's'}
          </Pill>
        </div>
        <div className="mt-auto grid grid-cols-3 gap-2 rounded-md border border-border-subtle bg-inset px-3.5 py-3">
          <Stat label="Trades" value={s?.n ?? 0} />
          <Stat label="Win rate" value={s?.winRate == null ? '—' : `${Math.round(s.winRate * 100)}%`} />
          <Stat label="Net P&L" value={s && s.n > 0 ? <Pnl cents={s.netCents} /> : '—'} />
        </div>
      </div>
    </Link>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone?: 'must' }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs',
        tone === 'must' ? 'border-ember/25 bg-ember/[0.07] text-warning' : 'border-border text-secondary',
      )}
    >
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="truncate text-base font-medium">{value}</span>
    </span>
  );
}

const tile = 'flex items-center justify-center overflow-hidden bg-hover text-faint';
const img = (id: string) => <img src={`/api/attachments/${id}/file`} alt="" loading="lazy" className="h-full w-full object-cover" />;

/** 1–3 example screenshots: one large tile, then up to two small ones, the last showing "+N" for the rest. */
function Collage({ ids, total }: { ids: string[]; total: number }) {
  const extra = total - ids.length;
  if (ids.length <= 1) {
    return (
      <div className="px-1.5 pt-1.5">
        <div className={cn(tile, 'h-[132px] rounded-sm')}>{ids[0] ? img(ids[0]) : <ImageIcon size={22} strokeWidth={1.5} aria-hidden />}</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[2fr_1fr] grid-rows-[64px_64px] gap-1 px-1.5 pt-1.5">
      <div className={cn(tile, 'row-span-2 rounded-[8px_4px_4px_4px]')}>{img(ids[0]!)}</div>
      <div className={cn(tile, 'rounded-[4px_8px_4px_4px]', ids.length === 2 && extra === 0 && 'row-span-2')}>{img(ids[1]!)}</div>
      {(ids[2] || extra > 0) && (
        <div className={cn(tile, 'relative rounded-[4px]')}>
          {ids[2] && img(ids[2])}
          {extra > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-xs font-medium text-white">+{extra}</span>}
        </div>
      )}
    </div>
  );
}

function NewPlayDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const create = useJournalMutation((t: string) => api.post<Play>('/plays', { title: t }));
  useEffect(() => {
    if (open) setTitle('');
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate(title.trim(), { onSuccess: (p) => navigate({ to: '/playbook/$playId', params: { playId: p.id } }) });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New play"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-play" disabled={!title.trim() || create.isPending}>
            Create and add criteria
          </Button>
        </>
      }
    >
      <form id="new-play" onSubmit={submit} className="space-y-3">
        <Field label="Name" hint="The entry model, for example “Opening range breakout”." error={create.error?.message}>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
      </form>
    </Dialog>
  );
}
