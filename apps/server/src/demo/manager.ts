import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync, rmSync } from 'node:fs';
import path from 'node:path';
import { demoDataDir, demoPort, host, port } from '../config';

const demoUrl = `http://${host}:${demoPort}`;
let child: ChildProcess | null = null;
let starting: Promise<string> | null = null;

async function demoHealth(): Promise<{ demo: boolean; pid?: number; startedAt: string } | null> {
  try {
    const res = await fetch(`${demoUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { demo?: boolean; pid?: number; startedAt: string };
    return body.demo ? { demo: true, pid: body.pid, startedAt: body.startedAt } : null;
  } catch {
    return null;
  }
}

function spawnDemo() {
  mkdirSync(path.join(demoDataDir, 'logs'), { recursive: true });
  const log = openSync(path.join(demoDataDir, 'logs', 'server.log'), 'a');
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      TC_DEMO: '1',
      TC_DATA_DIR: demoDataDir,
      TC_PORT: String(demoPort),
      TC_REAL_URL: `http://${host}:${port}`,
    },
    stdio: ['ignore', log, log],
  });
  child = proc;
  proc.on('exit', () => {
    if (child === proc) child = null;
  });
}

/** Start the demo copy if it isn't running, and resolve with its address once it answers. */
export function ensureDemo(): Promise<string> {
  starting ??= (async () => {
    if (await demoHealth()) return demoUrl;
    spawnDemo();
    // First start generates the sample data, which takes a few seconds.
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await demoHealth()) return demoUrl;
      if (!child) throw new Error("The demo didn't start. See demo/logs/server.log in the data folder.");
    }
    throw new Error('The demo took too long to start');
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export async function stopDemo(): Promise<void> {
  const h = await demoHealth();
  if (child) child.kill();
  else if (h?.pid) process.kill(h.pid);
  child = null;
}

/** Throw away the demo's data folder (never the real one) and start a freshly generated copy. */
export async function resetDemo(): Promise<string> {
  await stopDemo();
  for (let i = 0; i < 20 && (await demoHealth()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!demoDataDir.endsWith(`${path.sep}demo`)) throw new Error('Refusing to delete an unexpected folder');
  rmSync(demoDataDir, { recursive: true, force: true });
  return ensureDemo();
}

export async function demoStatus() {
  return { running: !!(await demoHealth()), url: demoUrl };
}

// Don't leave the demo running if the real app stops.
process.on('exit', () => child?.kill());
