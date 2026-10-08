import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { currentZone, decimalHours, durationMinutes, formatDuration, formatLocal, summarise, type FinancialYear, zoneLabel } from '@tc/domain';
import { ReportHeader } from '../../components/ReportHeader';
import { api, type Session } from '../../lib/api';
import { useSessionTypes } from '../../lib/sessions';

/** Print-friendly FY report. "Save as PDF" from the print dialog produces the PDF for the accountant. */
export function TimeLogReport({ fy: fyYear }: { fy: number }) {
  const { data } = useQuery({
    queryKey: ['session-report', fyYear],
    queryFn: () => api.get<{ fy: FinancialYear; sessions: Session[] }>(`/sessions/report?fy=${fyYear}`),
  });
  const { data: types = [] } = useSessionTypes();
  if (!data) return null;

  const { fy, sessions } = data;
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? 'Unknown';
  const total = sessions.reduce((sum, s) => sum + durationMinutes(s), 0);
  const byMonth = summarise(sessions, 'month');
  const byType = Object.entries(summarise(sessions, 'fy')[0]?.byType ?? {}).sort(([, a], [, b]) => b - a);

  const th = 'border-b border-black/30 py-1 pr-3 text-left font-semibold';
  const td = 'border-b border-black/10 py-1 pr-3 align-top';

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 text-[13px] text-black print:p-0">
      <ReportHeader
        title={`Business hours log — FY ${fy.label}`}
        subtitle={`${DateTime.fromISO(fy.start).toFormat('d LLLL yyyy')} to ${DateTime.fromISO(fy.end).toFormat('d LLLL yyyy')} · times in ${zoneLabel()} time (${currentZone()})`}
      />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded border border-black/20 p-3">
          <div className="text-black/60">Total hours</div>
          <div className="text-lg font-bold">{decimalHours(total).toFixed(2)}</div>
        </div>
        <div className="rounded border border-black/20 p-3">
          <div className="text-black/60">Sessions</div>
          <div className="text-lg font-bold">{sessions.length}</div>
        </div>
        <div className="rounded border border-black/20 p-3">
          <div className="text-black/60">Days worked</div>
          <div className="text-lg font-bold">{new Set(sessions.map((s) => s.tradingDay)).size}</div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-8">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Month</th>
              <th className={`${th} text-right`}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {byMonth.map((m) => (
              <tr key={m.key}>
                <td className={td}>{DateTime.fromISO(`${m.key}-01`).toFormat('LLLL yyyy')}</td>
                <td className={`${td} text-right tabular-nums`}>{decimalHours(m.minutes).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Activity</th>
              <th className={`${th} text-right`}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {byType.map(([typeId, minutes]) => (
              <tr key={typeId}>
                <td className={td}>{typeName(typeId)}</td>
                <td className={`${td} text-right tabular-nums`}>{decimalHours(minutes).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <table className="w-full">
        <thead>
          <tr>
            <th className={th}>Date</th>
            <th className={th}>Activity</th>
            <th className={th}>Start</th>
            <th className={th}>End</th>
            <th className={`${th} text-right`}>Duration</th>
            <th className={th}>Record</th>
            <th className={th}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="break-inside-avoid">
              <td className={td}>{DateTime.fromISO(s.tradingDay).toFormat('ccc d LLL')}</td>
              <td className={td}>{typeName(s.typeId)}</td>
              <td className={`${td} tabular-nums`}>{formatLocal(s.start, 'HH:mm')}</td>
              <td className={`${td} tabular-nums`}>{formatLocal(s.end!, 'HH:mm')}</td>
              <td className={`${td} text-right tabular-nums`}>{formatDuration(durationMinutes(s))}</td>
              <td className={td}>
                {s.source === 'timer' ? 'Timer' : 'Manual'}
                {s.editedAt ? ', edited' : ''}
              </td>
              <td className={td}>{s.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-black/60">
        "Timer" entries were recorded live with the start/stop timer. "Manual" entries were entered afterwards. Edits keep the original values in the
        app's edit history.
      </p>
    </div>
  );
}
