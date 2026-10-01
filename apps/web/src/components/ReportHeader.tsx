import { Printer } from 'lucide-react';
import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useSettings } from '../lib/settings';
import { Button } from './ui';

/** Title block for printable reports: who it's for, the period, and when it was generated. */
export function ReportHeader({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  const { data: settings } = useSettings();
  const abn = settings?.reportAbn?.replace(/\s/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
  return (
    <header className="mb-6 flex items-start justify-between gap-4 border-b border-black/20 pb-4">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {(settings?.reportName || abn) && (
          <p className="mt-0.5 font-medium">
            {settings?.reportName}
            {settings?.reportName && abn && ' · '}
            {abn && `ABN ${abn}`}
          </p>
        )}
        <p className="text-black/60">
          {subtitle} · generated {DateTime.now().toFormat('d LLL yyyy HH:mm')}
        </p>
      </div>
      <Button className="print:hidden" onClick={() => window.print()}>
        <Printer size={16} aria-hidden /> Print / Save as PDF
      </Button>
    </header>
  );
}
