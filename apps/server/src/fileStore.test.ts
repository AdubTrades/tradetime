import { describe, expect, it } from 'vitest';
import * as attachments from './attachments';
import { storage } from './config';
import { putObject, signedUrl, type StoreConfig } from './fileStore';
import { asUser, useTestDb } from './testing';

useTestDb();

function fakeStorage(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const cfg: StoreConfig = {
    url: 'https://proj.supabase.co',
    bucket: 'attachments',
    publishableKey: 'sb_publishable_test',
    secretKey: null,
    fetcher: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as typeof fetch,
  };
  return { cfg, calls };
}

describe('Supabase Storage client', () => {
  it('uploads into the bucket path with the user’s token', async () => {
    const { cfg, calls } = fakeStorage(() => new Response('{}', { status: 200 }));
    await putObject(cfg, 'user-jwt', 'u1/abc.png', new Uint8Array([1, 2, 3]), 'image/png');
    expect(calls[0]!.url).toBe('https://proj.supabase.co/storage/v1/object/attachments/u1/abc.png');
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer user-jwt', apikey: 'sb_publishable_test', 'x-upsert': 'true', 'Content-Type': 'image/png' });
  });

  it('returns an absolute signed link, or null when the file isn’t there', async () => {
    const ok = fakeStorage(() => Response.json({ signedURL: '/object/sign/attachments/u1/abc.png?token=t' }));
    expect(await signedUrl(ok.cfg, 'user-jwt', 'u1/abc.png')).toBe('https://proj.supabase.co/storage/v1/object/sign/attachments/u1/abc.png?token=t');
    expect(JSON.parse(String(ok.calls[0]!.init.body))).toEqual({ expiresIn: 3600 });
    const missing = fakeStorage(() => Response.json({ error: 'not_found' }, { status: 400 }));
    expect(await signedUrl(missing.cfg, 'user-jwt', 'u1/nope.png')).toBeNull();
  });

  it('refuses to call storage with neither a user nor a secret key', async () => {
    const { cfg } = fakeStorage(() => new Response('{}'));
    await expect(putObject(cfg, null, 'u1/a.png', new Uint8Array([1]), 'image/png')).rejects.toThrow(/No signed-in user/);
  });
});

describe('attachments (local storage)', () => {
  const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n]);

  it('stores identical files once per user, and keeps users apart', async () => {
    const a = await asUser(() => attachments.storeAttachment(png(1), 'image/png', 'a.png'), 'alice');
    const again = await asUser(() => attachments.storeAttachment(png(1), 'image/png', 'copy.png'), 'alice');
    expect(again.id).toBe(a.id);
    const b = await asUser(() => attachments.storeAttachment(png(1), 'image/png', 'b.png'), 'bob');
    expect(b.id).not.toBe(a.id);
    expect(await asUser(() => attachments.getAttachment(a.id), 'bob')).toBeUndefined();
  });

  it('enforces the per-user storage cap and allowed file types', async () => {
    const cap = storage.capBytes;
    storage.capBytes = 8;
    try {
      await asUser(() => attachments.storeAttachment(png(2), 'image/png', null), 'carol');
      await expect(asUser(() => attachments.storeAttachment(png(3), 'image/png', null), 'carol')).rejects.toThrow(/file storage/);
      // Someone else's usage doesn't count against you.
      await asUser(() => attachments.storeAttachment(png(4), 'image/png', null), 'dave');
    } finally {
      storage.capBytes = cap;
    }
    await expect(asUser(() => attachments.storeAttachment(Buffer.from('x'), 'text/html', null), 'carol')).rejects.toThrow(/Unsupported/);
  });

  it('only offers direct uploads when storage is in the cloud', async () => {
    await expect(asUser(() => attachments.prepareUpload({ sha256: 'a'.repeat(64), mime: 'image/png', bytes: 10, name: null }))).rejects.toThrow(/cloud storage/);
  });
});
