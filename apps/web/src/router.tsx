import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { AppShell } from './components/AppShell';
import { DevAttachments } from './pages/DevAttachments';
import { Placeholder } from './pages/Placeholder';
import { SettingsPage } from './pages/SettingsPage';

const rootRoute = createRootRoute({ component: AppShell });

const page = <TPath extends string>(path: TPath, title: string, phase: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => <Placeholder title={title} phase={phase} /> });

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: () => redirect({ to: '/journal' }) }),
  page('/journal', 'Journal', 'Phase 3'),
  page('/calendar', 'Calendar', 'Phase 5'),
  page('/time-log', 'Time log', 'Phase 1'),
  page('/expenses', 'Expenses', 'Phase 2'),
  page('/playbook', 'Playbook', 'Phase 3'),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage }),
  ...(import.meta.env.DEV ? [createRoute({ getParentRoute: () => rootRoute, path: '/dev/attachments', component: DevAttachments })] : []),
];

export const router = createRouter({ routeTree: rootRoute.addChildren(routes) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
