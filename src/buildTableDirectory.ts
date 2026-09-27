import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const outputPath = path.join(__dirname, '..', 'analysis', 'tableDirectory.json');

export interface TableDirectoryEntry {
  name: string;
  dirOffsetHex: string;
  pointer: number;
  pointerHex: string;
  /** Byte offset where this table's payload ends (next valid table's pointer, or EOF for the last table) */
  rangeEnd: number | null;
  /** rangeEnd - pointer, i.e. total payload bytes available to this table */
  rangeLength: number | null;
  /** false for TOC rows that don't look like real table pointers (out of file bounds, etc.) */
  isValidPointer: boolean;
}

function buildTableDirectory(): TableDirectoryEntry[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Save file not found at ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const raw: { name: string; dirOffset: number; pointer: number }[] = [];

  // Master table directory: offset 0x10 to 0x2B0, 8 bytes per entry
  // (4-byte ASCII FourCC name + 4-byte UInt32LE pointer)
  for (let off = 0x10; off < 0x2b0; off += 8) {
    const nameBytes = buffer.subarray(off, off + 4);
    const name = nameBytes.toString('ascii').replace(/[^A-Za-z0-9]/g, '').trim();
    if (!name) continue;

    const pointer = buffer.readUInt32LE(off + 4);
    raw.push({ name, dirOffset: off, pointer });
  }

  // A pointer is only "valid" if it lands strictly inside the file and past the
  // TOC/header region itself (real table payloads start well after 0x2B0).
  const isValidPointer = (pointer: number) => pointer > 0x2b0 && pointer < buffer.length;

  // Determine file-order ranges using only the valid pointers.
  const validSorted = raw
    .filter(e => isValidPointer(e.pointer))
    .slice()
    .sort((a, b) => a.pointer - b.pointer);

  const rangeByPointer = new Map<number, { rangeEnd: number; rangeLength: number }>();
  for (let i = 0; i < validSorted.length; i++) {
    const current = validSorted[i];
    const next = validSorted[i + 1];
    const rangeEnd = next ? next.pointer : buffer.length;
    rangeByPointer.set(current.pointer, { rangeEnd, rangeLength: rangeEnd - current.pointer });
  }

  const entries: TableDirectoryEntry[] = raw.map(e => {
    const valid = isValidPointer(e.pointer);
    const range = valid ? rangeByPointer.get(e.pointer) : undefined;
    return {
      name: e.name,
      dirOffsetHex: `0x${e.dirOffset.toString(16).toUpperCase().padStart(4, '0')}`,
      pointer: e.pointer,
      pointerHex: `0x${e.pointer.toString(16).toUpperCase().padStart(8, '0')}`,
      rangeEnd: range ? range.rangeEnd : null,
      rangeLength: range ? range.rangeLength : null,
      isValidPointer: valid
    };
  });

  return entries;
}

function main() {
  const entries = buildTableDirectory();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2));

  const validCount = entries.filter(e => e.isValidPointer).length;
  console.log(`TOTAL_TABLES=${entries.length} (valid pointers: ${validCount})`);
  console.table(entries.map(e => ({
    name: e.name,
    dirOffset: e.dirOffsetHex,
    pointer: e.pointerHex,
    rangeLength: e.rangeLength,
    valid: e.isValidPointer
  })));
  console.log(`\nSaved table directory to: ${outputPath}`);
}

main();
