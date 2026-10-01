import { useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatLocal, gradeTrade, isOnTick, latestReadingBefore, newId, pnlFromFills, riskPlan, rMultiple, simpleFills, tradingDay, type Fill, type GradeRule } from '@tc/domain';
import { AttachmentDropzone } from '../../components/AttachmentDropzone';
import { Dialog } from '../../components/Dialog';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import { MoneyInput } from '../../components/MoneyInput';
import { Button, cn, Field, Input, Select } from '../../components/ui';
import { api, type Attachment, type AttachmentLink, type StateReading, type TradeDetail } from '../../lib/api';
import { useDayReadings } from '../../lib/checkins';
import { ReadingChips } from '../../components/ReadingSummary';
import { useAccounts, useList } from '../../lib/expenses';
import { useAccountGroups, useContracts, useJournalMutation, usePlays } from '../../lib/journal';
import { instantToLocalTime, tradingDayTimeToInstant } from '../../lib/localTime';
import { useSettings } from '../../lib/settings';

type Direction = 'long' | 'short';
interface AccountPick {
  accountId: string;
  multiplier: number;
  feesCents: number | null;
}
interface FillDraft {
  key: string;
  time: string;
  side: 'buy' | 'sell';
  qty: string;
  price: string;
}

/** Fields that carry over to the next trade in batch entry. */
interface Carry {
  tradingDay: string;
  contractId: string;
  playId: string;
  accounts: AccountPick[];
}

interface Form extends Carry {
  checks: Record<string, boolean>;
  direction: Direction;
  stop: string;
  target: string;
  riskPoints: string;
  mode: 'simple' | 'fills';
  entryTime: string;
  entryPrice: string;
  exitTime: string;
  exitPrice: string;
  size: string;
  fills: FillDraft[];
  followedPlan: 'yes' | 'partly' | 'no' | null;
  emotionId: string;
  confidence: number | null;
  mistakeIds: string[];
  notes: string;
  reason: string;
  /** 'auto' = latest reading before entry; '' = none; otherwise a reading id. */
  state: string;
}

const LAST_CARRY_KEY = 'tc-last-trade-carry';
type LastCarry = { contractId: string; playId: string; accounts: { accountId: string; multiplier: number }[] };

function readLastCarry(): LastCarry | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_CARRY_KEY) ?? 'null') as LastCarry | null;
  } catch {
    return null;
  }
}

function writeLastCarry(carry: LastCarry): void {
  try {
    localStorage.setItem(LAST_CARRY_KEY, JSON.stringify(carry));
  } catch {
    // Not critical: the form just falls back to defaults.
  }
}

const num = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const blankFill = (side: 'buy' | 'sell'): FillDraft => ({ key: newId(), time: '', side, qty: '1', price: '' });

function fresh(carry: Carry): Form {
  return {
    ...carry,
    checks: {},
    direction: 'long',
    stop: '',
    target: '',
    riskPoints: '',
    mode: 'simple',
    entryTime: '',
    entryPrice: '',
    exitTime: '',
    exitPrice: '',
    size: '1',
    fills: [blankFill('buy'), blankFill('sell')],
    followedPlan: null,
    emotionId: '',
    confidence: null,
    mistakeIds: [],
    notes: '',
    reason: '',
    state: 'auto',
  };
}

function fromTrade(t: TradeDetail): Form {
  const base = t.accounts[0]!;
  const fills = [...base.fills].sort((a, b) => a.at.localeCompare(b.at)).map((f) => ({ ...f, qty: f.qty / base.multiplier }));
  const simple = fills.length === 2 && fills[0]!.qty === fills[1]!.qty;
  return {
    tradingDay: t.tradingDay,
    contractId: t.contractId,
    playId: t.playId ?? '',
    accounts: t.accounts.map((a) => ({ accountId: a.accountId, multiplier: a.multiplier, feesCents: a.feesCents })),
    checks: Object.fromEntries(t.checks.map((c) => [c.criterionId, c.checked])),
    direction: t.direction,
    stop: t.stopPrice?.toString() ?? '',
    target: t.targetPrice?.toString() ?? '',
    riskPoints: t.stopPrice == null ? (t.plannedRiskPoints?.toString() ?? '') : '',
    mode: simple ? 'simple' : 'fills',
    entryTime: simple ? instantToLocalTime(fills[0]!.at) : '',
    entryPrice: simple ? String(fills[0]!.price) : '',
    exitTime: simple ? instantToLocalTime(fills[1]!.at) : '',
    exitPrice: simple ? String(fills[1]!.price) : '',
    size: simple ? String(fills[0]!.qty) : '1',
    fills: fills.map((f) => ({ key: newId(), time: instantToLocalTime(f.at), side: f.side, qty: String(f.qty), price: String(f.price) })),
    followedPlan: t.followedPlan,
    emotionId: t.emotionId ?? '',
    confidence: t.confidence,
    mistakeIds: t.mistakeIds,
    notes: t.notes ?? '',
    reason: '',
    state: t.stateOverridden ? (t.stateReadingId ?? '') : 'auto',
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Edit this trade; omit for batch entry of new trades. */
  trade?: TradeDetail | null;
  /** Prefill for new trades (e.g. from a day's review page). */
  defaults?: Partial<Carry>;
}

export function TradeForm({ open, onClose, trade, defaults }: Props) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: contracts = [] } = useContracts();
  const { data: plays = [] } = usePlays();
  const { data: accounts = [] } = useAccounts();
  const { data: groups = [] } = useAccountGroups();
  const { data: moods = [] } = useList('mood');
  const { data: mistakes = [] } = useList('mistake');
  const rollover = settings?.rolloverTime ?? '10:00';

  const initialCarry = (): Carry => {
    // Start from what was used last time, as long as it still exists.
    const last = readLastCarry();
    const lastContract = contracts.find((c) => c.id === last?.contractId && !c.archived)?.id;
    const lastPlay = plays.find((p) => p.id === last?.playId && !p.archived)?.id;
    const lastAccounts = last?.accounts.filter((a) => accounts.some((x) => x.id === a.accountId && x.status === 'active'));
    return {
      tradingDay: defaults?.tradingDay ?? tradingDay(new Date(), rollover),
      contractId: defaults?.contractId ?? lastContract ?? contracts.find((c) => !c.archived)?.id ?? 'ct_mnq',
      playId: defaults?.playId ?? lastPlay ?? '',
      accounts:
        defaults?.accounts ??
        (lastAccounts?.length
          ? lastAccounts
          : (groups[0]?.members ?? accounts.filter((a) => a.status === 'active').slice(0, 1).map((a) => ({ accountId: a.id, multiplier: 1 })))
        ).map((m) => ({ ...m, feesCents: null })),
    };
  };

  const [form, setForm] = useState<Form>(() => (trade ? fromTrade(trade) : fresh(initialCarry())));
  const [tradeId, setTradeId] = useState(() => trade?.id ?? newId());
  const [savedCount, setSavedCount] = useState(0);
  useEffect(() => {
    if (!open) return;
    setForm(trade ? fromTrade(trade) : fresh(initialCarry()));
    setTradeId(trade?.id ?? newId());
    setSavedCount(0);
    // Only when the dialog opens; carried fields then persist between trades.
  }, [open, trade]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const contract = contracts.find((c) => c.id === form.contractId);
  const play = plays.find((p) => p.id === form.playId);
  const criteria = play?.criteria.filter((c) => !c.archived) ?? [];

  // ----- Live derived values -----
  const fills: Fill[] | null = useMemo(() => {
    const at = (time: string) => (time ? tradingDayTimeToInstant(form.tradingDay, time, rollover) : null);
    if (form.mode === 'simple') {
      const [entryAt, exitAt, entry, exit, size] = [at(form.entryTime), at(form.exitTime), num(form.entryPrice), num(form.exitPrice), num(form.size)];
      if (!entryAt || !exitAt || entry === null || exit === null || !size) return null;
      return simpleFills(form.direction, size, { at: entryAt, price: entry }, { at: exitAt, price: exit });
    }
    const rows = form.fills.map((f) => ({ at: at(f.time), side: f.side, qty: num(f.qty), price: num(f.price) }));
    if (rows.some((r) => !r.at || r.qty === null || r.price === null)) return null;
    return rows as Fill[];
  }, [form, rollover]);

  const preview = useMemo(() => {
    if (!fills || !contract) return null;
    try {
      const firstEntry = [...fills].sort((a, b) => a.at.localeCompare(b.at))[0]!.price;
      const base = pnlFromFills(fills, contract.pointValueCents);
      const plan = riskPlan(firstEntry, 1, contract.pointValueCents, { stopPrice: num(form.stop), targetPrice: num(form.target), riskPoints: num(form.riskPoints) });
      const rows = form.accounts.map((a) => {
        const gross = base.grossCents * a.multiplier;
        const fees = a.feesCents ?? base.totalQty * a.multiplier * contract.feePerSideCents;
        const risk = plan.riskPoints ? Math.round(plan.riskPoints * contract.pointValueCents * base.maxQty * a.multiplier) : null;
        return { ...a, gross, fees, net: gross - fees, risk };
      });
      const net = rows.reduce((s, r) => s + r.net, 0);
      const risk = rows.reduce((s, r) => s + (r.risk ?? 0), 0);
      return { base, plan, rows, net, r: rMultiple(net, risk || null), error: null };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [fills, contract, form.stop, form.target, form.riskPoints, form.accounts]);

  const grade = play ? gradeTrade(criteria.map((c) => ({ mustHave: c.mustHave, checked: !!form.checks[c.id] })), play.gradeRules as GradeRule[]) : null;
  const offTick = contract
    ? [form.entryPrice, form.exitPrice, form.stop, form.target, ...form.fills.map((f) => f.price)].filter((p) => num(p) !== null && !isOnTick(Number(p), contract.tickSize))
    : [];
  // In fills mode the direction comes from the first fill.
  const direction = form.mode === 'fills' ? (preview && !preview.error ? preview.base!.direction : form.fills[0]?.side === 'sell' ? 'short' : 'long') : form.direction;

  // ----- Save -----
  const save = useJournalMutation(async () => {
    const payload = {
      id: trade ? undefined : tradeId,
      tradingDay: form.tradingDay,
      contractId: form.contractId,
      playId: form.playId || null,
      checks: criteria.map((c) => ({ criterionId: c.id, checked: !!form.checks[c.id] })),
      stopPrice: num(form.stop),
      targetPrice: num(form.target),
      riskPoints: num(form.stop) === null ? num(form.riskPoints) : null,
      followedPlan: form.followedPlan,
      emotionId: form.emotionId || null,
      confidence: form.confidence,
      mistakeIds: form.mistakeIds,
      notes: form.notes || null,
      ...(form.state === 'auto' ? {} : { stateReadingId: form.state || null }),
      fills,
      accounts: form.accounts.map((a) => ({ accountId: a.accountId, multiplier: a.multiplier, feesCents: a.feesCents })),
    };
    if (trade) return api.put(`/trades/${trade.id}`, { ...payload, reason: form.reason || null });
    const created = await api.post('/trades', payload);
    writeLastCarry({ contractId: form.contractId, playId: form.playId, accounts: form.accounts.map(({ accountId, multiplier }) => ({ accountId, multiplier })) });
    return created;
  });

  const canSave = !!fills && !!preview && !preview.error && form.accounts.length > 0 && offTick.length === 0;
  const saveAndNext = () =>
    save.mutate(undefined, {
      onSuccess: () => {
        const { tradingDay: d, contractId, playId, accounts: a } = form;
        setForm(fresh({ tradingDay: d, contractId, playId, accounts: a.map((x) => ({ ...x, feesCents: null })) }));
        setTradeId(newId());
        setSavedCount((n) => n + 1);
      },
    });

  /** Cancelling a new trade detaches screenshots uploaded for it. */
  const cancel = async () => {
    if (!trade) {
      const links = await api.get<{ link: AttachmentLink; attachment: Attachment }[]>(`/attachments/for/trade/${tradeId}`).catch(() => []);
      await Promise.all(links.map(({ link }) => api.delete(`/attachments/links/${link.id}`)));
      void qc.invalidateQueries({ queryKey: ['attachments', 'trade', tradeId] });
    }
    onClose();
  };

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Unknown';
  const sectionTitle = 'font-display mb-3 text-[13px] text-brass';

  return (
    <Dialog
      open={open}
      onClose={cancel}
      title={trade ? 'Edit trade' : savedCount ? `Log trades · ${savedCount} saved` : 'Log trades'}
      width="max-w-4xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm">
            {preview && !preview.error && (
              <>
                Net <Pnl cents={preview.net!} className="font-semibold" />
                {preview.r !== null && <span className="text-muted"> · {preview.r}R</span>}
              </>
            )}
          </span>
          <Button variant="ghost" onClick={cancel}>
            {savedCount ? 'Done' : 'Cancel'}
          </Button>
          {trade ? (
            <Button variant="primary" disabled={!canSave || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
              Save
            </Button>
          ) : (
            <>
              <Button disabled={!canSave || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
                Save & close
              </Button>
              <Button variant="primary" disabled={!canSave || save.isPending} onClick={saveAndNext}>
                Save & add another
              </Button>
            </>
          )}
        </>
      }
    >
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
        {/* Carried context */}
        <section className="grid gap-3 rounded-md bg-surface-2 p-3 sm:grid-cols-[10rem_8rem_1fr]">
          <Field label="Trading day">
            <Input type="date" value={form.tradingDay} onChange={(e) => set('tradingDay', e.target.value)} />
          </Field>
          <Field label="Contract">
            <Select value={form.contractId} onChange={(e) => set('contractId', e.target.value)}>
              {contracts
                .filter((c) => !c.archived || c.id === form.contractId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.symbol}
                  </option>
                ))}
            </Select>
          </Field>
          <AccountsPicker value={form.accounts} onChange={(v) => set('accounts', v)} />
        </section>

        {/* 1. Setup — before the result, to limit hindsight bias */}
        <section>
          <h3 className={sectionTitle}>1 · Setup (tick what you saw before entering)</h3>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Play">
              <Select value={form.playId} onChange={(e) => setForm((f) => ({ ...f, playId: e.target.value, checks: {} }))}>
                <option value="">No Play</option>
                {plays
                  .filter((p) => !p.archived || p.id === form.playId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </Select>
            </Field>
            {form.mode === 'simple' && (
              <Field label="Direction">
                <div className="flex overflow-hidden rounded-full border border-text/15">
                  {(['long', 'short'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set('direction', d)}
                      className={cn('px-4 py-1.5 text-sm capitalize', form.direction === d ? 'bg-accent text-accent-text' : 'text-muted hover:text-text')}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>
          {play && (
            <div className="mt-3 rounded-md border border-border p-3">
              {criteria.length === 0 && <p className="text-sm text-muted">This Play has no criteria yet.</p>}
              <ul className="space-y-1.5">
                {criteria.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!form.checks[c.id]}
                        onChange={(e) => setForm((f) => ({ ...f, checks: { ...f.checks, [c.id]: e.target.checked } }))}
                      />
                      {c.label}
                      {c.mustHave && <span className="rounded-full px-1.5 text-xs text-ember ring-1 ring-inset ring-ember/60">must-have</span>}
                    </label>
                  </li>
                ))}
              </ul>
              {grade && (
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-2 text-sm">
                  <GradeBadge grade={grade.grade} outsidePlan={grade.outsidePlan} />
                  <span className="text-muted">
                    {grade.outsidePlan
                      ? `${grade.missedMustHave} must-have missed`
                      : grade.missedStandard
                        ? `${grade.missedStandard} standard criteria missed`
                        : 'All criteria met'}
                  </span>
                  {grade.grade && play.gradeRules.find((r) => r.grade === grade.grade)?.riskNote && (
                    <span className="text-muted">· your rule: {play.gradeRules.find((r) => r.grade === grade.grade)?.riskNote}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 2. Risk plan */}
        <section>
          <h3 className={sectionTitle}>2 · Risk plan</h3>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Stop price">
              <Input inputMode="decimal" value={form.stop} onChange={(e) => set('stop', e.target.value)} />
            </Field>
            <Field label="Target price">
              <Input inputMode="decimal" value={form.target} onChange={(e) => set('target', e.target.value)} />
            </Field>
            {form.stop.trim() === '' && (
              <Field label="Risk (points)" hint="If you didn't set a stop">
                <Input inputMode="decimal" value={form.riskPoints} onChange={(e) => set('riskPoints', e.target.value)} />
              </Field>
            )}
            {preview && !preview.error && preview.plan!.riskPoints && (
              <div className="text-sm sm:col-span-2 sm:self-end">
                <div className="text-muted">
                  Risk {preview.plan!.riskPoints} pts
                  {preview.plan!.plannedRR !== null && <> · planned {preview.plan!.plannedRR}:1</>}
                </div>
                <div className="text-muted">
                  ≈ <Pnl cents={-(preview.rows!.reduce((s, r) => s + (r.risk ?? 0), 0))} /> across accounts
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 3. Execution */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className={sectionTitle + ' mb-0'}>3 · Execution (Perth time, size for ×1 accounts)</h3>
            <button type="button" className="text-xs text-ember hover:underline" onClick={() => set('mode', form.mode === 'simple' ? 'fills' : 'simple')}>
              {form.mode === 'simple' ? 'Scaled in or out? Enter individual fills' : 'Single entry and exit'}
            </button>
          </div>
          {form.mode === 'simple' ? (
            <div className="grid gap-4 sm:grid-cols-5">
              <Field label="Entry time">
                <Input type="time" step={1} value={form.entryTime} onChange={(e) => set('entryTime', e.target.value)} />
              </Field>
              <Field label="Entry price">
                <Input inputMode="decimal" value={form.entryPrice} onChange={(e) => set('entryPrice', e.target.value)} />
              </Field>
              <Field label="Contracts">
                <Input type="number" min={1} value={form.size} onChange={(e) => set('size', e.target.value)} />
              </Field>
              <Field label="Exit time">
                <Input type="time" step={1} value={form.exitTime} onChange={(e) => set('exitTime', e.target.value)} />
              </Field>
              <Field label="Exit price">
                <Input inputMode="decimal" value={form.exitPrice} onChange={(e) => set('exitPrice', e.target.value)} />
              </Field>
            </div>
          ) : (
            <FillsEditor fills={form.fills} onChange={(v) => set('fills', v)} />
          )}
          {offTick.length > 0 && contract && (
            <p className="mt-2 text-sm text-loss">
              {offTick.join(', ')} {offTick.length === 1 ? "isn't a valid price" : "aren't valid prices"} for {contract.symbol} (tick {contract.tickSize}).
            </p>
          )}
          {preview?.error && <p className="mt-2 text-sm text-loss">{preview.error}</p>}
          <p className="mt-1 text-xs text-muted">Times before {rollover} count as after midnight on this trading day.</p>
        </section>

        {/* 4. Result */}
        {preview && !preview.error && (
          <section>
            <h3 className={sectionTitle}>4 · Result ({direction})</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-1 font-medium">Account</th>
                  <th className="pb-1 text-right font-medium">Size</th>
                  <th className="pb-1 text-right font-medium">Gross</th>
                  <th className="w-36 pb-1 text-right font-medium">Fees</th>
                  <th className="pb-1 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows!.map((r, i) => (
                  <tr key={r.accountId}>
                    <td className="py-1.5">{accountName(r.accountId)}</td>
                    <td className="tabular py-1.5 text-right">×{r.multiplier}</td>
                    <td className="py-1.5 text-right">
                      <Pnl cents={r.gross} />
                    </td>
                    <td className="py-1.5 pl-4">
                      <MoneyInput
                        aria-label={`Fees for ${accountName(r.accountId)}`}
                        value={r.feesCents ?? r.fees}
                        onChange={(v) => set('accounts', form.accounts.map((a, j) => (j === i ? { ...a, feesCents: v } : a)))}
                        className="h-8"
                      />
                    </td>
                    <td className="py-1.5 text-right font-medium">
                      <Pnl cents={r.net} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {contract && contract.feePerSideCents === 0 && (
              <p className="mt-1 text-xs text-muted">Tip: set {contract.symbol}'s fee per side in Settings → Contracts to fill fees automatically.</p>
            )}
          </section>
        )}

        {/* 5. Behaviour */}
        <section>
          <h3 className={sectionTitle}>5 · Behaviour</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Followed my plan?">
              <div className="flex overflow-hidden rounded-full border border-text/15">
                {(['yes', 'partly', 'no'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set('followedPlan', form.followedPlan === v ? null : v)}
                    className={cn('flex-1 px-3 py-1.5 text-sm capitalize', form.followedPlan === v ? 'bg-accent text-accent-text' : 'text-muted')}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Emotional state">
              <Select value={form.emotionId} onChange={(e) => set('emotionId', e.target.value)}>
                <option value="">—</option>
                {moods
                  .filter((m) => !m.archived || m.id === form.emotionId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Confidence">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set('confidence', form.confidence === n ? null : n)}
                    className={cn('h-8 w-8 rounded-md border text-sm', form.confidence === n ? 'border-accent bg-accent text-accent-text' : 'border-border text-muted')}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="mr-1 self-center text-sm text-muted">Mistakes:</span>
            {mistakes
              .filter((m) => !m.archived || form.mistakeIds.includes(m.id))
              .map((m) => {
                const on = form.mistakeIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => set('mistakeIds', on ? form.mistakeIds.filter((x) => x !== m.id) : [...form.mistakeIds, m.id])}
                    className={cn('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-ember bg-ember/10 text-text' : 'border-text/15 text-muted hover:text-text')}
                  >
                    {m.name}
                  </button>
                );
              })}
          </div>
        </section>

        <StatePicker day={form.tradingDay} value={form.state} onChange={(v) => set('state', v)} entryAt={fills ? [...fills].sort((a, b) => a.at.localeCompare(b.at))[0]!.at : null} />

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Notes">
            <textarea
              rows={5}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-2 focus:outline-ember"
            />
          </Field>
          <div>
            <div className="mb-1 text-sm font-medium">Screenshots</div>
            {open && <AttachmentDropzone ownerType="trade" ownerId={tradeId} role="chart" />}
          </div>
        </section>

        {trade && (
          <Field label="Reason for edit" hint="Optional, kept in the edit history">
            <Input value={form.reason} onChange={(e) => set('reason', e.target.value)} />
          </Field>
        )}
        {save.error && <p className="text-sm text-loss">{save.error.message}</p>}
      </form>
    </Dialog>
  );
}

function AccountsPicker({ value, onChange }: { value: AccountPick[]; onChange: (v: AccountPick[]) => void }) {
  const { data: accounts = [] } = useAccounts();
  const { data: groups = [] } = useAccountGroups();
  const unused = accounts.filter((a) => a.status === 'active' && !value.some((v) => v.accountId === a.id));
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Unknown';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Accounts</span>
        {groups.length > 0 && (
          <select
            aria-label="Use account group"
            className="rounded border border-border bg-surface px-1 text-xs text-muted"
            value=""
            onChange={(e) => {
              const g = groups.find((x) => x.id === e.target.value);
              if (g) onChange(g.members.map((m) => ({ ...m, feesCents: null })));
            }}
          >
            <option value="">Use group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((a, i) => (
          <span key={a.accountId} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pr-1 pl-2.5 text-xs">
            {name(a.accountId)}
            <select
              aria-label={`Size multiplier for ${name(a.accountId)}`}
              value={a.multiplier}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, multiplier: Number(e.target.value) } : x)))}
              className="rounded bg-surface-2 px-0.5 text-xs"
            >
              {[1, 2, 3, 4, 5, 10].map((n) => (
                <option key={n} value={n}>
                  ×{n}
                </option>
              ))}
            </select>
            <button type="button" aria-label={`Remove ${name(a.accountId)}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-muted hover:text-loss">
              <X size={12} />
            </button>
          </span>
        ))}
        {unused.length > 0 && (
          <select
            aria-label="Add account"
            className="rounded-full border border-dashed border-border bg-transparent px-2 py-0.5 text-xs text-muted"
            value=""
            onChange={(e) => e.target.value && onChange([...value, { accountId: e.target.value, multiplier: 1, feesCents: null }])}
          >
            <option value="">+ Add account</option>
            {unused.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        {accounts.length === 0 && <span className="text-xs text-loss">Add a trading account in Settings first.</span>}
      </div>
    </div>
  );
}

function FillsEditor({ fills, onChange }: { fills: FillDraft[]; onChange: (f: FillDraft[]) => void }) {
  const update = (i: number, patch: Partial<FillDraft>) => onChange(fills.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[8rem_6rem_5rem_1fr_2rem] gap-2 text-xs text-muted">
        <span>Time</span>
        <span>Side</span>
        <span>Qty</span>
        <span>Price</span>
      </div>
      {fills.map((f, i) => (
        <div key={f.key} className="grid grid-cols-[8rem_6rem_5rem_1fr_2rem] items-center gap-2">
          <Input type="time" step={1} aria-label="Fill time" value={f.time} onChange={(e) => update(i, { time: e.target.value })} />
          <Select aria-label="Side" value={f.side} onChange={(e) => update(i, { side: e.target.value as 'buy' | 'sell' })}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </Select>
          <Input type="number" min={1} aria-label="Quantity" value={f.qty} onChange={(e) => update(i, { qty: e.target.value })} />
          <Input inputMode="decimal" aria-label="Price" value={f.price} onChange={(e) => update(i, { price: e.target.value })} />
          <Button variant="ghost" className="px-1.5" aria-label="Remove fill" disabled={fills.length <= 2} onClick={() => onChange(fills.filter((_, j) => j !== i))}>
            <X size={14} />
          </Button>
        </div>
      ))}
      <Button variant="ghost" onClick={() => onChange([...fills, blankFill(fills[fills.length - 1]?.side ?? 'sell')])}>
        <Plus size={14} aria-hidden /> Add fill
      </Button>
    </div>
  );
}

/** Which session-start/check-in reading applies to this trade. Auto picks the latest before entry. */
function StatePicker({ day, value, onChange, entryAt }: { day: string; value: string; onChange: (v: string) => void; entryAt: string | null }) {
  const { data: readings = [] } = useDayReadings(day);
  if (readings.length === 0) return null;
  const auto = entryAt ? latestReadingBefore(readings, entryAt) : null;
  const label = (r: StateReading) => `${r.kind === 'start' ? 'Session start' : 'Check-in'} ${formatLocal(r.at, 'HH:mm')}`;
  const shown = value === 'auto' ? auto : readings.find((r) => r.id === value);
  return (
    <section>
      <h3 className="mb-2 text-xs tracking-wide text-muted uppercase">State at entry</h3>
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="State reading" className="w-64" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="auto">Auto{auto ? ` (${label(auto)})` : entryAt ? ' (none before entry)' : ''}</option>
          {readings.map((r) => (
            <option key={r.id} value={r.id}>
              {label(r)}
            </option>
          ))}
          <option value="">None</option>
        </Select>
        {shown && <ReadingChips answers={shown.answers} decision={shown.decision} />}
      </div>
    </section>
  );
}
