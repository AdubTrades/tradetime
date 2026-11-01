import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HorizontalLine, LineTools, SimAccount } from '@tc/domain';
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

/**
 * A document saved per instrument (`/backtest/<kind>/<instrument>`). Changes show at once and are saved shortly
 * after, in one request for a burst of edits (typing a label, a replay filling orders). Undefined while loading.
 */
function useSavedDoc<T>(kind: string, instrument: string, what: string): [T | undefined, (value: T) => void, string | null] {
  const [state, setState] = useState<{ instrument: string; value: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ instrument: string; value: T } | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) api.put(`/backtest/${kind}/${p.instrument}`, p.value).catch((err: Error) => setError(`Couldn’t save your ${what}: ${err.message}`));
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

/** The lines on an instrument's chart. */
export function useLines(instrument: string): [HorizontalLine[], (lines: HorizontalLine[]) => void, string | null] {
  const [doc, setDoc, error] = useSavedDoc<{ lines: HorizontalLine[] }>('drawings', instrument, 'lines');
  const setLines = useCallback((lines: HorizontalLine[]) => setDoc({ lines }), [setDoc]);
  return [doc?.lines ?? [], setLines, error];
}

/** The simulated trading account on an instrument: null if there isn't one yet, undefined while loading. */
export function useSimAccount(instrument: string): [SimAccount | null | undefined, (account: SimAccount) => void, string | null] {
  return useSavedDoc<SimAccount | null>('sim', instrument, 'practice account') as [SimAccount | null | undefined, (account: SimAccount) => void, string | null];
}
