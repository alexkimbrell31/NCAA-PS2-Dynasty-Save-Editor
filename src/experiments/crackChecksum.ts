/**
 * Identify what the dwords at file +0x14 and table +0x1C actually are.
 *
 * Both are currently LABELLED "checksum", but that is a guess inherited from
 * other EA DB documentation -- exactly the mnemonic-grade evidence the label
 * audit taught us to distrust. Before building a write path on top of them we
 * need to know:
 *
 *   1. Are they even variable? A field that is constant or mostly zero is not
 *      a checksum and may not need maintaining at all.
 *   2. Do they correlate with something structural (size, record count)? If so
 *      they are derived metadata, not integrity values.
 *   3. If they are checksums, which algorithm over which byte range?
 *
 * This matters enormously for the write path: if nothing verifies integrity,
 * writing is a solved problem the moment the bit writer works. If something
 * does, we must reproduce it exactly or the game rejects the save.
 */
import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const header = parseFileHeader(buf);
const toc = parseToc(buf, header);

const hex = (n: number) => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

// ---------------------------------------------------------------------------
// 1. What do these values look like?
// ---------------------------------------------------------------------------
console.log('=== FILE HEADER ===');
console.log(`dbSize      ${hex(header.dbSize)}  (${header.dbSize})`);
console.log(`tableCount  ${header.tableCount}`);
console.log(`+0x14       ${hex(header.checksum)}  (${header.checksum})`);
// Dump the whole header so nothing is assumed away.
console.log('\nRaw file header bytes 0x00-0x18:');
for (let off = 0; off < 0x18; off += 4) {
  console.log(`  +0x${off.toString(16).padStart(2, '0')}  ${hex(buf.readUInt32LE(off))}`);
}

// Sort the TOC by offset so we can derive each table's true length.
const sorted = [...toc].sort((a, b) => a.realOffset - b.realOffset);
interface Tbl {
  name: string;
  start: number;
  end: number;
  hdr: ReturnType<typeof parseTableHeader>;
}
const tables: Tbl[] = sorted.map((e, i) => ({
  name: e.name,
  start: e.realOffset,
  end: i + 1 < sorted.length ? sorted[i + 1].realOffset : header.dbSize,
  hdr: parseTableHeader(buf, e.realOffset),
}));

console.log('\n=== TABLE +0x1C VALUES (first 20 by offset) ===');
console.log('name   +0x1C        flags        recLen  cur/max     length');
for (const t of tables.slice(0, 20)) {
  console.log(
    `${t.name.padEnd(5)}  ${hex(t.hdr.checksum)}  ${hex(t.hdr.flags)}  ` +
      `${String(t.hdr.recordLenBytes).padStart(5)}  ` +
      `${String(t.hdr.currentRecords).padStart(5)}/${String(t.hdr.maxRecords).padEnd(5)}  ` +
      `${t.end - t.start}`,
  );
}

const cks = tables.map((t) => t.hdr.checksum);
const distinct = new Set(cks);
const zero = cks.filter((c) => c === 0).length;
console.log(`\n${distinct.size} distinct +0x1C values across ${tables.length} tables; ${zero} are zero`);
console.log(`range ${hex(Math.min(...cks))} .. ${hex(Math.max(...cks))}`);

// A real checksum should look like noise. Structural metadata usually does not:
// it clusters in low values and correlates with size or count.
const small = cks.filter((c) => c < 0x10000).length;
console.log(`${small}/${cks.length} values fit in 16 bits (a 32-bit hash would rarely)`);

// Does it just equal something we already know?
console.log('\n=== IS IT STRUCTURAL RATHER THAN A HASH? ===');
const candidates: { label: string; fn: (t: Tbl) => number }[] = [
  { label: 'table length', fn: (t) => t.end - t.start },
  { label: 'recLen * maxRecords', fn: (t) => t.hdr.recordLenBytes * t.hdr.maxRecords },
  { label: 'recLen * currentRecords', fn: (t) => t.hdr.recordLenBytes * t.hdr.currentRecords },
  { label: 'dataOffset - start', fn: (t) => t.hdr.dataOffset - t.start },
  { label: 'start offset', fn: (t) => t.start },
  { label: 'fieldCount', fn: (t) => t.hdr.fieldCount },
];
for (const c of candidates) {
  const hits = tables.filter((t) => c.fn(t) === t.hdr.checksum).length;
  console.log(`  ${c.label.padEnd(26)} matches ${hits}/${tables.length}`);
}

// ---------------------------------------------------------------------------
// 2. Checksum algorithm search
// ---------------------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

const algos: { name: string; fn: (b: Buffer, s: number, e: number) => number }[] = [
  {
    name: 'sum8',
    fn: (b, s, e) => {
      let v = 0;
      for (let i = s; i < e; i++) v = (v + b[i]) >>> 0;
      return v >>> 0;
    },
  },
  {
    name: 'xor32le',
    fn: (b, s, e) => {
      let v = 0;
      for (let i = s; i + 3 < e; i += 4) v = (v ^ b.readUInt32LE(i)) >>> 0;
      return v >>> 0;
    },
  },
  {
    name: 'sum32le',
    fn: (b, s, e) => {
      let v = 0;
      for (let i = s; i + 3 < e; i += 4) v = (v + b.readUInt32LE(i)) >>> 0;
      return v >>> 0;
    },
  },
  {
    name: 'crc32',
    fn: (b, s, e) => {
      let c = 0xffffffff;
      for (let i = s; i < e; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    },
  },
  {
    name: 'crc32-noinv',
    fn: (b, s, e) => {
      let c = 0;
      for (let i = s; i < e; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
      return c >>> 0;
    },
  },
  {
    name: 'adler32',
    fn: (b, s, e) => {
      let a = 1;
      let bb = 0;
      for (let i = s; i < e; i++) {
        a = (a + b[i]) % 65521;
        bb = (bb + a) % 65521;
      }
      return ((bb << 16) | a) >>> 0;
    },
  },
];

// Ranges are expressed relative to the table so they can be tried uniformly.
const ranges: { name: string; fn: (t: Tbl) => [number, number] }[] = [
  { name: 'whole table', fn: (t) => [t.start, t.end] },
  { name: 'after checksum dword', fn: (t) => [t.start + 0x20, t.end] },
  { name: 'header only', fn: (t) => [t.start, t.start + 0x24] },
  { name: 'descriptors only', fn: (t) => [t.hdr.fieldsOffset, t.hdr.dataOffset] },
  { name: 'data (current recs)', fn: (t) => [t.hdr.dataOffset, t.hdr.dataOffset + t.hdr.currentRecords * t.hdr.recordLenBytes] },
  { name: 'data (max recs)', fn: (t) => [t.hdr.dataOffset, t.hdr.dataOffset + t.hdr.maxRecords * t.hdr.recordLenBytes] },
  { name: 'data -> table end', fn: (t) => [t.hdr.dataOffset, t.end] },
  { name: 'descriptors + data', fn: (t) => [t.hdr.fieldsOffset, t.end] },
];

// Test on a handful of tables with different shapes. Requiring a hit on ALL of
// them avoids the coincidence problem -- any single table can match by chance.
const probes = tables.filter((t) => ['CONF', 'PLAY', 'TEAM', 'STAD', 'SCHD', 'COCH'].includes(t.name));
console.log(`\n=== ALGORITHM SEARCH (must match all ${probes.length} probe tables) ===`);

let found = false;
for (const r of ranges) {
  for (const a of algos) {
    const hits = probes.filter((t) => {
      const [s, e] = r.fn(t);
      if (s < 0 || e > buf.length || e <= s) return false;
      return a.fn(buf, s, e) === t.hdr.checksum;
    }).length;
    if (hits > 0) {
      console.log(`  ${hits}/${probes.length}  ${a.name} over ${r.name}`);
      if (hits === probes.length) found = true;
    }
  }
}
if (!found) console.log('  no algorithm/range combination matched all probes');

// Show what the probe tables actually hold, for manual inspection.
console.log('\n=== PROBE TABLE DETAIL ===');
for (const t of probes) {
  console.log(
    `${t.name}: +0x1C=${hex(t.hdr.checksum)} flags=${hex(t.hdr.flags)} ` +
      `len=${t.end - t.start} recs=${t.hdr.currentRecords}/${t.hdr.maxRecords}`,
  );
}

// ---------------------------------------------------------------------------
// 3. Same search for the file-level dword at 0x14
// ---------------------------------------------------------------------------
console.log('\n=== FILE +0x14 SEARCH ===');
const fileRanges: { name: string; range: [number, number] }[] = [
  { name: 'whole file', range: [0, header.dbSize] },
  { name: 'after 0x18 (past header)', range: [0x18, header.dbSize] },
  { name: 'after checksum', range: [0x18, buf.length] },
  { name: 'TOC only', range: [0x18, 0x18 + header.tableCount * 8] },
  { name: 'first table onward', range: [0x2b0, header.dbSize] },
  { name: 'whole buffer', range: [0, buf.length] },
];
for (const r of fileRanges) {
  for (const a of algos) {
    const [s, e] = r.range;
    if (e > buf.length) continue;
    if (a.fn(buf, s, e) === header.checksum) {
      console.log(`  MATCH: ${a.name} over ${r.name}`);
    }
  }
}
console.log(`  (file dword is ${hex(header.checksum)}; buffer is ${buf.length} bytes, dbSize ${header.dbSize})`);
