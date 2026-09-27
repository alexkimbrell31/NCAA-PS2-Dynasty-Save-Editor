import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const tocPath = path.join(__dirname, '..', 'analysis', 'tableDirectory.json');

// Adapted from bep713/madden-db-editor's TableConstants.js + TableReader.js,
// which document the shared EA DB format used by Madden titles of this era:
//   FILE_HEADER_SIZE = 24, TABLE_HEADER_SIZE = 40,
//   TABLE_DEFINITION_SIZE = 8, TABLE_FIELD_SIZE = 16
// NCAA 07's on-disk bytes don't match Madden's header layout at a fixed offset
// (the 40 bytes immediately before PLAY's known descriptor block are all zero),
// so instead of trusting a fixed offset, we brute-force search every byte
// position within a table's TOC-declared range for a header candidate, and
// validate it against a strong constraint: dataStart + curRecords*lenBytes
// must land very close to the table's declared rangeEnd.

const TABLE_HEADER_SIZE = 40;
const TABLE_FIELD_SIZE = 16;

interface TocEntry {
  name: string;
  pointer: number;
  pointerHex: string;
  rangeEnd: number;
  rangeLength: number;
}

interface HeaderCandidate {
  offset: number;
  offsetHex: string;
  lenBytes: number;
  lenBits: number;
  maxRecords: number;
  curRecords: number;
  numFields: number;
  fieldStart: number;
  dataStart: number;
  predictedEnd: number;
  slack: number;
}

function searchForHeader(buffer: Buffer, rangeStart: number, rangeEnd: number, endian: 'LE' | 'BE'): HeaderCandidate[] {
  const candidates: HeaderCandidate[] = [];
  const read16 = (o: number) => endian === 'LE' ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o);
  const read32 = (o: number) => endian === 'LE' ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o);

  for (let offset = rangeStart; offset < rangeEnd - TABLE_HEADER_SIZE; offset++) {
    const numFields = buffer[offset + 28];
    if (numFields < 3 || numFields > 150) continue;

    const maxRecords = read16(offset + 21);
    const curRecords = read16(offset + 23);
    if (curRecords < 5 || curRecords > 20000) continue;
    if (maxRecords < curRecords || maxRecords > 20000) continue;

    const lenBytes = read32(offset + 11);
    if (lenBytes < 8 || lenBytes > 400) continue;

    const fieldStart = offset + TABLE_HEADER_SIZE;
    const dataStart = fieldStart + numFields * TABLE_FIELD_SIZE;
    const predictedEnd = dataStart + curRecords * lenBytes;
    const slack = Math.abs(predictedEnd - rangeEnd);

    // Allow slack up to 4 record-widths to account for trailing padding/other data
    if (slack > lenBytes * 4) continue;

    candidates.push({
      offset,
      offsetHex: `0x${offset.toString(16).toUpperCase().padStart(6, '0')}`,
      lenBytes,
      lenBits: read32(offset + 15),
      maxRecords,
      curRecords,
      numFields,
      fieldStart,
      dataStart,
      predictedEnd,
      slack
    });
  }

  return candidates;
}

function main() {
  const buffer = fs.readFileSync(filePath);
  const toc: TocEntry[] = JSON.parse(fs.readFileSync(tocPath, 'utf-8'));

  const play = toc.find(t => t.name === 'PLAY');
  if (!play) {
    throw new Error('PLAY not found in tableDirectory.json');
  }

  console.log(`PLAY range: ${play.pointerHex} - 0x${play.rangeEnd.toString(16).toUpperCase()} (${play.rangeLength} bytes)`);

  for (const endian of ['LE', 'BE'] as const) {
    const candidates = searchForHeader(buffer, play.pointer, play.rangeEnd, endian);
    candidates.sort((a, b) => a.slack - b.slack);

    console.log(`\n[${endian}] Header candidates found: ${candidates.length}`);
    console.table(candidates.slice(0, 20).map(c => ({
      offset: c.offsetHex,
      numFields: c.numFields,
      lenBytes: c.lenBytes,
      maxRecords: c.maxRecords,
      curRecords: c.curRecords,
      dataStart: `0x${c.dataStart.toString(16).toUpperCase()}`,
      predictedEnd: `0x${c.predictedEnd.toString(16).toUpperCase()}`,
      slack: c.slack
    })));
  }
}

main();
