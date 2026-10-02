import { deflateSync } from 'node:zlib';

/** Small deterministic random generator so the demo looks the same every time it's reset. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * A chart-style screenshot (candles plus entry, stop and target lines) as a PNG, for demo galleries
 * and trade screenshots. `outcome` decides whether price runs to the target or the stop after entry.
 */
export function chartPng(seed: number, opts: { direction: 'long' | 'short'; outcome: 'win' | 'loss'; width?: number; height?: number }): Buffer {
  const W = opts.width ?? 800;
  const H = opts.height ?? 450;
  const px = Buffer.alloc(W * H * 3);
  const bg = hex('#141413');
  const grid = hex('#26241f');
  const candleUp = hex('#d9d6cf');
  const candleDown = hex('#6f6b63');
  const ember = hex('#ff682c');
  const stopC = hex('#b8382c');
  const targetC = hex('#4f9a6c');
  const set = (x: number, y: number, c: RGB) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: RGB) => {
    for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(H - 1, Math.max(y0, y1)); y++)
      for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(W - 1, Math.max(x0, x1)); x++) set(x, y, c);
  };
  const hline = (y: number, c: RGB, dashed = false, from = 0) => {
    for (let x = from; x < W; x++) if (!dashed || Math.floor(x / 8) % 2 === 0) set(x, y, c);
  };

  rect(0, 0, W - 1, H - 1, bg);
  for (let y = 40; y < H; y += 60) hline(y, grid);
  for (let x = 60; x < W; x += 80) for (let y = 0; y < H; y++) set(x, y, grid);

  // Price path: drift sideways, then break in the trade direction, then run to the target or reverse to the stop.
  const r = rng(seed);
  const n = 64;
  const entryAt = 34;
  const dir = opts.direction === 'long' ? 1 : -1;
  const closes: number[] = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    let drift = (r() - 0.5) * 1.2;
    if (i >= entryAt - 4 && i < entryAt) drift += 0.9 * dir;
    if (i >= entryAt) drift += (opts.outcome === 'win' ? 0.55 : -0.7) * dir;
    p += drift;
    closes.push(p);
  }
  const entry = closes[entryAt]!;
  const risk = 3.2;
  const stop = entry - risk * dir;
  const target = entry + risk * 2 * dir;
  const all = [...closes, stop, target];
  const min = Math.min(...all) - 1.5;
  const max = Math.max(...all) + 1.5;
  const y = (v: number) => Math.round(H - 20 - ((v - min) / (max - min)) * (H - 40));
  const cw = Math.floor((W - 40) / n);

  let prev = closes[0]! - 0.3;
  closes.forEach((c, i) => {
    const x = 20 + i * cw;
    const o = prev;
    const hi = Math.max(o, c) + r() * 0.8;
    const lo = Math.min(o, c) - r() * 0.8;
    const col = c >= o ? candleUp : candleDown;
    rect(x + Math.floor(cw / 2), y(hi), x + Math.floor(cw / 2), y(lo), col);
    rect(x + 1, y(o), x + cw - 2, y(c), col);
    prev = c;
  });

  const ex = 20 + entryAt * cw;
  hline(y(target), targetC, true, ex);
  hline(y(stop), stopC, true, ex);
  hline(y(entry), ember, false, ex);
  rect(ex - 3, y(entry) - 3, ex + 3, y(entry) + 3, ember);

  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let row = 0; row < H; row++) {
    raw[row * (W * 3 + 1)] = 0;
    px.copy(raw, row * (W * 3 + 1) + 1, row * W * 3, (row + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
