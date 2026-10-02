import { homedir } from 'node:os';
import path from 'node:path';

export const isProduction = process.env.NODE_ENV === 'production';
export const port = Number(process.env.TC_PORT ?? 4317);
export const host = '127.0.0.1';

export const dataDir = path.resolve(process.env.TC_DATA_DIR ?? path.join(homedir(), 'TradingCompanion'));
export const paths = {
  db: path.join(dataDir, 'app.db'),
  attachments: path.join(dataDir, 'attachments'),
  localBackups: path.join(dataDir, 'backups-local'),
  logs: path.join(dataDir, 'logs'),
  tmp: path.join(dataDir, 'tmp'),
  /** A restore staged here is swapped in on the next start, before the database opens. */
  restorePending: path.join(dataDir, 'restore-pending'),
};

/** This process is the demo copy: sample data only, no notifications, backups or outside connections. */
export const isDemo = process.env.TC_DEMO === '1';
/** Where the real app keeps the demo copy's data, and the port the demo serves on. */
export const demoDataDir = path.join(dataDir, 'demo');
export const demoPort = port + 3;
/** Set on the demo copy so its "Exit demo" link can find the real app. */
export const realAppUrl = process.env.TC_REAL_URL ?? null;

export const webDist = path.resolve(import.meta.dirname, '../../web/dist');
