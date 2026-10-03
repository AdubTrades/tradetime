import { useQuery } from '@tanstack/react-query';
import { FileUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { financialYear, financialYearOf } from '@tc/domain';
import { HistoryDialog } from '../../components/HistoryDialog';
import { Button, PageHeader, SegmentedTabs, Select } from '../../components/ui';
import { api, type Expense } from '../../lib/api';
import { useExpenseLookups } from '../../lib/expenses';
import { todayLocal } from '../../lib/localTime';
import { ExpenseDialog } from './ExpenseDialog';
import { ExpensesTab } from './ExpensesTab';
import { ImportDialog } from './ImportDialog';
import { PayoutsTab } from './PayoutsTab';
import { RecurringDialog, RecurringTab, type RecurringDraft } from './RecurringTab';
import { SummaryTab } from './SummaryTab';

const tabs = [
  { id: 'expenses', label: 'Expenses' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'summary', label: 'FY summary' },
] as const;
type Tab = (typeof tabs)[number]['id'];

const expenseFieldLabels: Record<string, string> = {
  name: 'Name',
  vendor: 'Vendor',
  date: 'Date',
  description: 'Description',
  categoryId: 'Category',
  typeId: 'Type',
  paymentMethodId: 'Payment method',
  accountId: 'Account',
  exGstCents: 'Amount ex GST',
  gstCents: 'GST',
  incGstCents: 'Amount inc GST',
  businessUsePct: 'Business use %',
};

export function ExpensesPage() {
  const currentFy = financialYearOf(todayLocal()).startYear;
  const [fy, setFy] = useState(currentFy);
  const [tab, setTab] = useState<Tab>('expenses');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [recurringDraft, setRecurringDraft] = useState<RecurringDraft | null>(null);
  const lookups = useExpenseLookups();
  const { data: years = [currentFy] } = useQuery({ queryKey: ['expenses', 'years'], queryFn: () => api.get<number[]>('/expenses/years') });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Expenses"
        description="Business costs for tax time, in AUD."
        actions={
          <>
            <Select aria-label="Financial year" className="w-[140px]" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  FY {financialYear(y).label}
                </option>
              ))}
            </Select>
            <Button onClick={() => setImporting(true)}>
              <FileUp size={15} aria-hidden /> Import CSV
            </Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={14} aria-hidden /> Add expense
            </Button>
          </>
        }
      />
      <SegmentedTabs label="Expenses view" className="-mt-6 flex-wrap self-start" value={tab} onChange={setTab} options={tabs.map((t) => ({ value: t.id, label: t.label }))} />

      {tab === 'expenses' && <ExpensesTab fy={fy} onEdit={setEditing} />}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'payouts' && <PayoutsTab fy={fy} />}
      {tab === 'summary' && <SummaryTab fy={fy} />}

      <ExpenseDialog
        open={editing !== null}
        expense={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onHistory={setHistoryFor}
        onMakeRecurring={(e) => {
          setEditing(null);
          setRecurringDraft({ ...e, startDate: e.date });
        }}
      />
      <RecurringDialog item={null} draft={recurringDraft} open={!!recurringDraft} onClose={() => setRecurringDraft(null)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <HistoryDialog
        url={historyFor ? `/expenses/${historyFor}/history` : null}
        onClose={() => setHistoryFor(null)}
        fieldLabels={expenseFieldLabels}
        formatValue={(field, v) => {
          if (field.endsWith('Cents') && typeof v === 'number') return (v / 100).toFixed(2);
          if (field.endsWith('Id')) return lookups.name(v as string) || undefined;
          if (field === 'businessUsePct') return `${v}%`;
        }}
        describeCreate={(v) => {
          const snap = v as { source?: string; recurringId?: string | null } | null;
          return snap?.source === 'csv-import' ? 'Imported from CSV' : 'Created';
        }}
      />
    </div>
  );
}
