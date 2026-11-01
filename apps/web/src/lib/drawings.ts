import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HorizontalLine, LineTools } from '@tc/domain';
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
 * The lines on an instrument's chart. Changes show at once and are saved shortly after (one request for a burst of
 * edits, such as typing a label).
 */
export function useLines(instrument: string): [HorizontalLine[], (lines: HorizontalLine[]) => void, string | null] {
  const [state, setState] = useState<{ instrument: string; lines: HorizontalLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ instrument: string; lines: HorizontalLine[] } | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) api.put(`/backtest/drawings/${p.instrument}`, { lines: p.lines }).catch((err: Error) => setError(`Couldn’t save your lines: ${err.message}`));
  }, []);

  useEffect(() => {
    let live = true;
    setState(null);
    api
      .get<{ lines: HorizontalLine[] }>(`/backtest/drawings/${instrument}`)
      .then((d) => live && setState({ instrument, lines: d.lines }))
      .catch((err: Error) => live && setError(`Couldn’t load your lines: ${err.message}`));
    return () => {
      live = false;
      flush();
    };
  }, [instrument, flush]);

  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [flush]);

  const setLines = useCallback(
    (lines: HorizontalLine[]) => {
      setState({ instrument, lines });
      setError(null);
      pending.current = { instrument, lines };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [instrument, flush],
  );

  return [state?.instrument === instrument ? state.lines : [], setLines, error];
}
