import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, BookImage, History, Pencil, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { formatLocal } from '@tc/domain';
import { AttachmentDropzone } from '../../components/AttachmentDropzone';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import { HistoryDialog } from '../../components/HistoryDialog';
import { ReadingChips } from '../../components/ReadingSummary';
import { Button, Card, cn, PageHeader } from '../../components/ui';
import { api, type Attachment } from '../../lib/api';
import { useAccounts, useList } from '../../lib/expenses';
import { useContracts, useJournalMutation, usePlays, useTrade } from '../../lib/journal';
import { TradeForm } from './TradeForm';

const tradeFieldLabels: Record<string, string> = {
  tradingDay: 'Trading day',
  contractId: 'Contract',
  direction: 'Direction',
  playId: 'Play',
  grade: 'Grade',
  outsidePlan: 'Outside plan',
  stopPrice: 'Stop',
  targetPrice: 'Target',
  plannedRiskPoints: 'Risk (points)',
  followedPlan: 'Followed plan',
  notes: 'Notes',
  ticked: 'Criteria ticked',
  fills: 'Fills',
  accounts: 'Accounts',
};

export function TradeDetailPage({ tradeId }: { tradeId: string }) {
  const navigate = useNavigate();
  const { data: t, error } = useTrade(tradeId);
  const { data: plays = [] } = usePlays();
  const { data: contracts = [] } = useContracts();
  const { data: accounts = [] } = useAccounts();
  const { data: moods = [] } = useList('mood');
  const { data: mistakes = [] } = useList('mistake');
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const remove = useJournalMutation(() => api.delete(`/trades/${tradeId}`));
  const send = useJournalMutation((attachmentId: string) => api.post(`/trades/${tradeId}/send-to-playbook`, { attachmentId }));

  if (error) return <p className="text-sm text-loss">{error.message}</p>;
  if (!t) return null;
  const play = plays.find((p) => p.id === t.playId);
  const contract = contracts.find((c) => c.id === t.contractId);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Unknown';
  const base = t.accounts[0];
  const baseFills = base ? base.fills.map((f) => ({ ...f, qty: f.qty / base.multiplier })) : [];

  return (
    <div className="max-w-5xl space-y-6">
      <Link to="/journal" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft size={14} aria-hidden /> Journal
      </Link>
      <PageHeader
        title={`${contract?.symbol ?? ''} ${t.direction} · ${DateTime.fromISO(t.tradingDay).toFormat('ccc d LLL yyyy')}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setHistory(true)}>
              <History size={16} aria-hidden /> History
            </Button>
            <Button
              variant="ghost"
              className="text-loss"
              onClick={() => window.confirm('Delete this trade? It stays in the edit history.') && remove.mutate(undefined, { onSuccess: () => navigate({ to: '/journal' }) })}
            >
              <Trash2 size={16} aria-hidden /> Delete
            </Button>
            <Button variant="primary" onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden /> Edit
            </Button>
          </>
        }
      />

      {t.needsReview && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-inset px-5 py-4 text-sm">
          <span className="flex-1">
            <span className="font-medium">Imported from your broker.</span>{' '}
            <span className="text-muted">Add the Play, tick what you saw before entry, and note how you felt — the fills and P&L are already in.</span>
          </span>
          <Button variant="primary" onClick={() => setEditing(true)}>
            Review trade
          </Button>
        </div>
      )}
      {!t.needsReview && t.source === 'import' && <p className="-mt-4 text-xs text-muted">Fills imported from your broker.</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Net (USD)" value={<Pnl cents={t.netCents} />} />
        <Stat label="R multiple" value={t.r === null ? '—' : `${t.r}R`} />
        <Stat label="Play" value={play?.title ?? 'No Play'} />
        <Stat label="Grade" value={<GradeBadge grade={t.grade} outsidePlan={t.outsidePlan} />} />
        <Stat
          label="Day"
          value={
            <Link to="/journal/day/$day" params={{ day: t.tradingDay }} className="hover:underline">
              Daily review →
            </Link>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Checklist (ticked before entry)">
          {t.checks.length === 0 ? (
            <p className="text-sm text-muted">No Play selected.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {t.checks.map((c) => (
                <li key={c.criterionId} className={cn('flex items-center gap-2', !c.checked && 'text-muted')}>
                  <span className={cn('w-4 text-center', c.checked ? 'text-text' : c.mustHave ? 'text-ember' : 'text-muted')}>{c.checked ? '✓' : '✗'}</span>
                  {c.label}
                  {c.mustHave && <span className="rounded-full border border-ember/25 bg-ember/[0.07] px-2 text-xs text-warning">must-have</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Risk plan">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Stop</dt>
            <dd className="tabular">{t.stopPrice ?? '—'}</dd>
            <dt className="text-muted">Target</dt>
            <dd className="tabular">{t.targetPrice ?? '—'}</dd>
            <dt className="text-muted">Planned risk</dt>
            <dd className="tabular">
              {t.plannedRiskPoints ? `${t.plannedRiskPoints} pts` : '—'}
              {t.accounts.some((a) => a.plannedRiskCents) && (
                <span className="text-muted"> · ${(t.accounts.reduce((s, a) => s + (a.plannedRiskCents ?? 0), 0) / 100).toFixed(2)}</span>
              )}
            </dd>
            <dt className="text-muted">Planned R:R</dt>
            <dd className="tabular">
              {t.plannedRiskPoints && t.targetPrice && baseFills[0] ? `${(Math.abs(t.targetPrice - baseFills[0].price) / t.plannedRiskPoints).toFixed(2)}:1` : '—'}
            </dd>
            <dt className="text-muted">Actual</dt>
            <dd className="tabular">{t.r === null ? '—' : `${t.r}R`}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Execution">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted">Fills (×1 size, Perth time)</h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {baseFills.map((f) => (
                  <tr key={f.id}>
                    <td className="tabular py-1 text-muted">{formatLocal(f.at, 'HH:mm:ss')}</td>
                    <td className={'py-1 capitalize text-muted'}>{f.side}</td>
                    <td className="tabular py-1 text-right">{f.qty}</td>
                    <td className="tabular py-1 text-right">{f.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted">Accounts</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">Account</th>
                  <th className="py-1 text-right font-medium">Size</th>
                  <th className="py-1 text-right font-medium">Gross</th>
                  <th className="py-1 text-right font-medium">Fees</th>
                  <th className="py-1 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {t.accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="py-1">{accountName(a.accountId)}</td>
                    <td className="tabular py-1 text-right">{a.maxQty}</td>
                    <td className="py-1 text-right">
                      <Pnl cents={a.grossCents} />
                    </td>
                    <td className="tabular py-1 text-right text-muted">${(a.feesCents / 100).toFixed(2)}</td>
                    <td className="py-1 text-right font-medium">
                      <Pnl cents={a.netCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              Avg entry {base?.avgEntry} · avg exit {base?.avgExit}
            </p>
          </div>
        </div>
      </Card>

      <Card title="Behaviour">
        <dl className="grid gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted">Followed plan</dt>
          <dd className="capitalize">{t.followedPlan ?? '—'}</dd>
          <dt className="text-muted">Emotional state</dt>
          <dd>{moods.find((m) => m.id === t.emotionId)?.name ?? '—'}</dd>
          <dt className="text-muted">Confidence</dt>
          <dd>{t.confidence ? `${t.confidence} / 5` : '—'}</dd>
          <dt className="text-muted">State at entry</dt>
          <dd>
            {t.state ? (
              <>
                <span className="mr-2 text-xs text-muted">
                  {t.state.kind === 'start' ? 'Session start' : 'Check-in'} {formatLocal(t.state.at, 'HH:mm')}
                  {t.stateOverridden ? ' (chosen)' : ''}
                </span>
                <ReadingChips answers={t.state.answers} />
              </>
            ) : (
              <span className="text-muted">None</span>
            )}
          </dd>
          <dt className="text-muted">Mistakes</dt>
          <dd>{t.mistakeIds.length ? t.mistakeIds.map((id) => mistakes.find((m) => m.id === id)?.name).join(', ') : 'None'}</dd>
        </dl>
        {t.notes && <p className="mt-3 text-sm whitespace-pre-wrap">{t.notes}</p>}
      </Card>

      <Card title="Screenshots" description={play && t.grade ? `“Send to Playbook” adds a screenshot to ${play.title}'s ${t.grade} shelf.` : undefined}>
        <AttachmentDropzone
          ownerType="trade"
          ownerId={t.id}
          role="chart"
          renderActions={(a: Attachment) =>
            play && t.grade && a.mime.startsWith('image/') ? (
              <button
                type="button"
                disabled={sent.has(a.id) || send.isPending}
                onClick={() => send.mutate(a.id, { onSuccess: () => setSent((s) => new Set(s).add(a.id)) })}
                className="flex w-full items-center justify-center gap-1 text-xs text-muted hover:text-text disabled:text-ember"
              >
                <BookImage size={12} aria-hidden /> {sent.has(a.id) ? 'Added to Playbook' : 'Send to Playbook'}
              </button>
            ) : null
          }
        />
        {send.error && <p className="mt-2 text-sm text-loss">{send.error.message}</p>}
      </Card>

      <TradeForm open={editing} onClose={() => setEditing(false)} trade={t} />
      <HistoryDialog url={history ? `/trades/${t.id}/history` : null} onClose={() => setHistory(false)} fieldLabels={tradeFieldLabels} formatValue={(_, v) => (Array.isArray(v) ? v.join('; ') : undefined)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="tile px-5 py-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-display mt-1 text-xl leading-tight">{value}</div>
    </div>
  );
}
