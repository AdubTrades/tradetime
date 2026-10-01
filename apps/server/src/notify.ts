import { execFile } from 'node:child_process';

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Show a macOS notification. Best-effort: failures are logged, never thrown. */
export function notify(title: string, message: string): void {
  if (process.platform !== 'darwin' || process.env.VITEST) return;
  const script = `display notification ${quote(message)} with title ${quote(title)} sound name "Glass"`;
  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error(`[notify] ${err.message}`);
  });
}
