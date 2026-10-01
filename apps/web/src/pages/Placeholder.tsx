import { PageHeader } from '../components/ui';

export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="panel p-10 text-center text-sm text-muted">Coming in {phase}.</div>
    </div>
  );
}
