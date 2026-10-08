import { execFile } from 'node:child_process';
import { authEnabled } from './config';
import { pushToUser, type PushPayload } from './push';

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Notify the current user (call inside their scope): Web Push to each of their devices. The local single-user
 * Mac app (no sign-in) also shows a macOS notification. Best-effort: failures are logged, never thrown.
 */
export async function notify(title: string, message: string, opts: Omit<PushPayload, 'title' | 'body'> = {}): Promise<void> {
  await pushToUser({ title, body: message, ...opts }).catch((err) => console.error(`[notify] ${(err as Error).message}`));
  if (authEnabled || process.platform !== 'darwin' || process.env.VITEST) return;
  const script = `display notification ${quote(message)} with title ${quote(title)} sound name "Glass"`;
  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error(`[notify] ${err.message}`);
  });
}
