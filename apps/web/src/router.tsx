import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { financialYearOf, localDate } from '@tc/domain';
import { AppShell } from './components/AppShell';
import { DevAttachments } from './pages/DevAttachments';
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
  page('/journal', 'Journal', 'Phase 3'),
  page('/calendar', 'Calendar', 'Phase 5'),
  createRoute({ getParentRoute: () => shellRoute, path: '/time-log', component: TimeLogPage }),
  page('/expenses', 'Expenses', 'Phase 2'),
  page('/playbook', 'Playbook', 'Phase 3'),
  createRoute({ getParentRoute: () => shellRoute, path: '/settings', component: SettingsPage }),
  ...(import.meta.env.DEV ? [createRoute({ getParentRoute: () => shellRoute, path: '/dev/attachments', component: DevAttachments })] : []),
];

/** Print views render without the app chrome. */
const timeLogReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/time-log/report',
  validateSearch: (search: Record<string, unknown>): { fy: number } => {
    const fy = Number(search.fy);
    return { fy: Number.isInteger(fy) ? fy : financialYearOf(localDate(new Date())).startYear };
  },
  component: function ReportRoute() {
    const { fy } = timeLogReportRoute.useSearch();
    return <TimeLogReport fy={fy} />;
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([shellRoute.addChildren(shellRoutes), timeLogReportRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
