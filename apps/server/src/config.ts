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
};

export const webDist = path.resolve(import.meta.dirname, '../../web/dist');
