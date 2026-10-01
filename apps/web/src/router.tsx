import { createRootRoute, createRoute, createRouter, Outlet, redirect, useParams } from '@tanstack/react-router';
import { financialYearOf, localDate } from '@tc/domain';
import { AppShell } from './components/AppShell';
import { DevAttachments } from './pages/DevAttachments';
import { ExpensesPage } from './pages/expenses/ExpensesPage';
import { DayPage } from './pages/journal/DayPage';
import { JournalPage } from './pages/journal/JournalPage';
import { TradeDetailPage } from './pages/journal/TradeDetailPage';
import { PlaybookPage } from './pages/playbook/PlaybookPage';
import { PlayDetailPage } from './pages/playbook/PlayDetailPage';
import { ExpensesReport } from './pages/expenses/ExpensesReport';
import { Placeholder } from './pages/Placeholder';
import { SettingsPage } from './pages/SettingsPage';
import { TimeLogPage } from './pages/timelog/TimeLogPage';
import { TimeLogReport } from './pages/timelog/TimeLogReport';

const rootRoute = createRootRoute({ component: Outlet });

/** Screens inside the app window with the left navigation. */
const shellRoute = createRoute({ getParentRoute: () => rootRoute, id: 'shell', component: AppShell });

const page = <TPath extends string>(path: TPath, title: string, phase: string) =>
  createRoute({ getParentRoute: () => shellRoute, path, component: () => <Placeholder title={title} phase={phase} /> });

const shellRoutes = [
  createRoute({ getParentRoute: () => shellRoute, path: '/', beforeLoad: () => redirect({ to: '/journal' }) }),
  createRoute({ getParentRoute: () => shellRoute, path: '/journal', component: JournalPage }),
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/journal/trades/$tradeId',
    component: function TradeRoute() {
      const { tradeId } = useParams({ strict: false }) as { tradeId: string };
      return <TradeDetailPage key={tradeId} tradeId={tradeId} />;
    },
  }),
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/journal/day/$day',
    component: function DayRoute() {
      const { day } = useParams({ strict: false }) as { day: string };
      return <DayPage key={day} day={day} />;
    },
  }),
  page('/calendar', 'Calendar', 'Phase 5'),
  createRoute({ getParentRoute: () => shellRoute, path: '/time-log', component: TimeLogPage }),
  createRoute({ getParentRoute: () => shellRoute, path: '/expenses', component: ExpensesPage }),
  createRoute({ getParentRoute: () => shellRoute, path: '/playbook', component: PlaybookPage }),
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/playbook/$playId',
    component: function PlayRoute() {
      const { playId } = useParams({ strict: false }) as { playId: string };
      return <PlayDetailPage key={playId} playId={playId} />;
    },
  }),
  createRoute({ getParentRoute: () => shellRoute, path: '/settings', component: SettingsPage }),
  ...(import.meta.env.DEV ? [createRoute({ getParentRoute: () => shellRoute, path: '/dev/attachments', component: DevAttachments })] : []),
];

const fySearch = (search: Record<string, unknown>): { fy: number } => {
  const fy = Number(search.fy);
  return { fy: Number.isInteger(fy) ? fy : financialYearOf(localDate(new Date())).startYear };
};

/** Print views render without the app chrome. */
const timeLogReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/time-log/report',
  validateSearch: fySearch,
  component: function TimeLogReportRoute() {
    return <TimeLogReport fy={timeLogReportRoute.useSearch().fy} />;
  },
});

const expensesReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/report',
  validateSearch: fySearch,
  component: function ExpensesReportRoute() {
    return <ExpensesReport fy={expensesReportRoute.useSearch().fy} />;
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([shellRoute.addChildren(shellRoutes), timeLogReportRoute, expensesReportRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
