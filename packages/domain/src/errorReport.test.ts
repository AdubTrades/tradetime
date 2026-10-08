import { describe, expect, it } from 'vitest';
import { buildEnvelope, parseDsn } from './errorReport';

describe('error reports', () => {
  it('reads a Sentry DSN', () => {
    expect(parseDsn('https://abc123@o42.ingest.sentry.io/4507')).toEqual({ url: 'https://o42.ingest.sentry.io/api/4507/envelope/?sentry_key=abc123&sentry_version=7', key: 'abc123' });
    expect(parseDsn('not a dsn')).toBeNull();
  });

  it('builds an envelope with the error and user id only', () => {
    const e = buildEnvelope('https://abc@o1.ingest.sentry.io/9', new TypeError('boom'), { platform: 'node', userId: 'u1', url: '/api/trades', method: 'POST' })!;
    const [header, item, event] = e.body.split('\n').map((l) => JSON.parse(l));
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({ platform: 'node', level: 'error', user: { id: 'u1' }, request: { url: '/api/trades', method: 'POST' }, exception: { values: [{ type: 'TypeError', value: 'boom' }] } });
    expect(JSON.stringify(event)).not.toContain('@example');
  });
});
