export interface BlueprintPackageEntry {
  data: Buffer;
  name: string;
}

export function writeTarStringField(header: Buffer, offset: number, length: number, value: string): void {
  const encoded = Buffer.from(value);
  encoded.copy(header, offset, 0, Math.min(encoded.length, length));
}

export function writeTarOctalField(header: Buffer, offset: number, length: number, value: number): void {
  const encoded = Math.max(0, Math.trunc(value)).toString(8).padStart(length - 1, "0");
  writeTarStringField(header, offset, length, `${encoded}\0`);
}

export function buildTarArchive(entries: BlueprintPackageEntry[]): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);
    writeTarStringField(header, 0, 100, entry.name);
    writeTarOctalField(header, 100, 8, 0o644);
    writeTarOctalField(header, 108, 8, 0);
    writeTarOctalField(header, 116, 8, 0);
    writeTarOctalField(header, 124, 12, entry.data.length);
    writeTarOctalField(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeTarStringField(header, 257, 6, "ustar");
    writeTarStringField(header, 263, 2, "00");

    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    const checksumValue = checksum.toString(8).padStart(6, "0");
    writeTarStringField(header, 148, 8, `${checksumValue}\0 `);

    blocks.push(header, entry.data);
    const remainder = entry.data.length % 512;
    if (remainder !== 0) {
      blocks.push(Buffer.alloc(512 - remainder, 0));
    }
  }

  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}
