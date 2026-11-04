import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Drawings, HorizontalLine, LineTools, Shape, SimAccount, Timeframe } from '@tc/domain';
import { api } from './api';

const EMPTY_TOOLS: LineTools = { templates: [], last: null };

/** Line templates and the look of the next new line, saved to the account. */
export function useLineTools() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['backtest', 'lineTools'], queryFn: () => api.get<LineTools>('/backtest/line-tools') });
  const save = useMutation({
    mutationFn: (tools: LineTools) => api.put<LineTools>('/backtest/line-tools', tools),
    onMutate: (tools) => qc.setQueryData(['backtest', 'lineTools'], tools),
  });
  const tools = query.data ?? EMPTY_TOOLS;
  return { tools, saveTools: save.mutate };
}

/** A backtesting session: one instrument, its own practice account, replay time, timeframe and lines. */
export interface BacktestSession {
  id: string;
  name: string;
  description?: string | null;
  /** The Playbook Play being practised; journaled trades get it. */
  playId?: string | null;
  instrument: string;
  accountId: string;
  tf: Timeframe;
  cursor: number | null;
  createdAt: string;
  updatedAt: string;
  trades: number;
  net: number;
}

export function useSessions() {
  return useQuery({ queryKey: ['backtest', 'sessions'], queryFn: () => api.get<BacktestSession[]>('/backtest/sessions') });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description: string | null; playId: string | null; instrument: string; startBalance: number; cursor: number | null; tf: Timeframe }) =>
      api.post<BacktestSession>('/backtest/sessions', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['backtest', 'sessions'] });
      // The first session may have created the Backtesting account.
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useUpdateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; description?: string | null; playId?: string | null; tf?: Timeframe; cursor?: number | null }) =>
      api.patch<BacktestSession>(`/backtest/sessions/${id}`, patch),
    onSuccess: (s) => qc.setQueryData<BacktestSession[]>(['backtest', 'sessions'], (list) => list?.map((x) => (x.id === s.id ? s : x))),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/backtest/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backtest', 'sessions'] }),
  });
}

/**
 * A document saved per session (`/backtest/<kind>/<sessionId>`). Changes show at once and are saved shortly after,
 * in one request for a burst of edits (typing a label, a replay filling orders). Undefined while loading.
 */
function useSavedDoc<T, R = unknown>(kind: string, key: string, what: string, onSaved?: (response: R) => void): [T | undefined, (value: T) => void, string | null] {
  const instrument = key;
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const [state, setState] = useState<{ instrument: string; value: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ instrument: string; value: T } | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p)
      api
        .put<R>(`/backtest/${kind}/${p.instrument}`, p.value)
        .then((res) => saved.current?.(res))
        .catch((err: Error) => setError(`Couldn’t save your ${what}: ${err.message}`));
  }, [kind, what]);

  useEffect(() => {
    let live = true;
    setState(null);
    api
      .get<T>(`/backtest/${kind}/${instrument}`)
      .then((value) => live && setState({ instrument, value }))
      .catch((err: Error) => live && setError(`Couldn’t load your ${what}: ${err.message}`));
    return () => {
      live = false;
      flush();
    };
  }, [kind, instrument, what, flush]);

  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [flush]);

  const set = useCallback(
    (value: T) => {
      setState({ instrument, value });
      setError(null);
      pending.current = { instrument, value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [instrument, flush],
  );

  return [state?.instrument === instrument ? state.value : undefined, set, error];
}

/** What's drawn in a session: horizontal lines, and rectangles and long/short tools. */
export function useDrawings(sessionId: string) {
  const [doc, setDoc, error] = useSavedDoc<Drawings>('drawings', sessionId, 'drawings');
  // Lines and shapes are edited separately; each change merges into the latest copy.
  const latest = useRef<Drawings>({ lines: [], shapes: [] });
  latest.current = { lines: doc?.lines ?? [], shapes: doc?.shapes ?? [] };
  const setLines = useCallback((lines: HorizontalLine[]) => setDoc((latest.current = { ...latest.current, lines })), [setDoc]);
  const setShapes = useCallback((shapes: Shape[]) => setDoc((latest.current = { ...latest.current, shapes })), [setDoc]);
  return { lines: latest.current.lines, shapes: latest.current.shapes!, setLines, setShapes, error };
}

export interface JournalResult {
  journaled: number;
  failed: { id: string; message: string }[];
}

/** A session's practice account (undefined while loading). Saving it also puts newly closed trades in the journal. */
export function useSimAccount(sessionId: string, onJournal?: (r: JournalResult) => void): [SimAccount | null | undefined, (account: SimAccount) => void, string | null] {
  const qc = useQueryClient();
  const handle = useCallback(
    (r: JournalResult) => {
      if (r.journaled) {
        // New journal trades (and maybe a new contract, e.g. BTCUSDT): refresh what the journal shows.
        for (const key of ['trades', 'contracts', 'accounts']) void qc.invalidateQueries({ queryKey: [key] });
        void qc.invalidateQueries({ queryKey: ['backtest', 'sessions'] });
        void qc.invalidateQueries({ queryKey: ['backtest', 'journalIds', sessionId] });
      }
      onJournal?.(r);
    },
    [qc, onJournal, sessionId],
  );
  return useSavedDoc<SimAccount | null, JournalResult>('sim', sessionId, 'practice account', handle) as [SimAccount | null | undefined, (account: SimAccount) => void, string | null];
}

/** Which journal trade each of a session's practice trades became, so the History tab can open them. */
export function useSimJournalIds(sessionId: string) {
  return useQuery({ queryKey: ['backtest', 'journalIds', sessionId], queryFn: () => api.get<Record<string, string>>(`/backtest/sim/${sessionId}/journal`) }).data ?? {};
}
