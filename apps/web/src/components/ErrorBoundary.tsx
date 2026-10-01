import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui';

interface State {
  error: Error | null;
}

/** Shows a recoverable message instead of a blank screen if a page crashes. Data on the server is unaffected. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Navigating to another page clears the error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-xl rounded-lg border border-loss/30 bg-loss/5 p-6">
        <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
        <p className="mt-1 text-sm text-muted">Your data is safe — it's stored by the app's server, not this page. Reloading usually fixes it.</p>
        <pre className="mt-3 overflow-x-auto rounded bg-surface-2 p-2 text-xs text-muted">{this.state.error.message}</pre>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
        </div>
      </div>
    );
  }
}
