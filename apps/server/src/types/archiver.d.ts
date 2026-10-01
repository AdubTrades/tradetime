// archiver v8 ships without types; this covers the subset we use.
declare module 'archiver' {
  import type { Readable } from 'node:stream';
  export class ZipArchive extends Readable {
    constructor(options?: { zlib?: { level?: number } });
    append(source: Readable | Buffer | string, data: { name: string }): this;
    file(filepath: string, data: { name: string }): this;
    directory(dirpath: string, destpath: string | false): this;
    finalize(): Promise<void>;
    pointer(): number;
  }
}
