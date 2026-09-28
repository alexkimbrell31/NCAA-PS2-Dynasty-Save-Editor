/**
 * What does the +0x1C dword actually cover?
 *
 * Established so far: it is not a checksum over record data (tables with zero
 * data bytes still hold distinct values), and it is not a hash of the table
 * name. So it covers the schema, the header, or something else entirely.
 *
 * Two techniques here:
 *
 * 1. RESIDUAL TEST. If the algorithm is a known one wrapped in unknown init /
 *    final-XOR constants, the raw result will differ from the stored value by a
 *    CONSTANT. So instead of demanding an exact match, compute the candidate
 *    over every table and ask whether `stored XOR computed` (or `stored minus
 *    computed`) is the same for all 82. That finds the algorithm even when the
 *    constants are wrong, which a plain equality search cannot.
 *
 * 2. SCHEMA-GROUPING TEST. Group tables by byte-identical descriptor blocks.
 *    If two tables share a schema but differ at +0x1C, the value must depend on
 *    something beyond the schema.
 */
import {
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const header = parseFileHeader(buf);
const toc = parseToc(buf, header);
const hex = (n: number) => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

const sorted = [...toc].sort((a, b) => a.realOffset - b.realOffset);
const tables = sorted.map((e, i) => ({
  name: e.name,
  start: e.realOffset,
  end: i + 1 < sorted.length ? sorted[i + 1].realOffset : header.dbSize,
  hdr: parseTableHeader(buf, e.realOffset),
}));

// ---------------------------------------------------------------------------
// 1. Do tables with identical schemas share a +0x1C value?
// ---------------------------------------------------------------------------
console.log('=== SCHEMA GROUPING ===');
const bySchema = new Map<string, typeof tables>();
for (const t of tables) {
  const key = buf.toString('hex', t.hdr.fieldsOffset, t.hdr.dataOffset);
  if (!bySchema.has(key)) bySchema.set(key, []);
  bySchema.get(key)!.push(t);
}
const shared = [...bySchema.values()].filter((g) => g.length > 1);
console.log(`${bySchema.size} distinct descriptor blocks across ${tables.length} tables`);
for (const g of shared) {
  const same = new Set(g.map((t) => t.hdr.checksum)).size === 1;
  console.log(
    `  identical schema: ${g.map((t) => t.name).join(', ')} -> ` +
      `${same ? 'SAME +0x1C' : 'DIFFERENT +0x1C'} (${g.map((t) => hex(t.hdr.checksum)).join(', ')})`,
  );
}
if (shared.length === 0) console.log('  (no two tables share a byte-identical schema)');

// ---------------------------------------------------------------------------
// 2. Residual test across algorithms x ranges
// ---------------------------------------------------------------------------
const crcRefl = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
const crcFwd = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0;
    t[i] = c >>> 0;
  }
  return t;
})();

type Algo = (b: Buffer, s: number, e: number) => number;
const algos: { name: string; fn: Algo }[] = [
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
    name: 'crc32-reflected',
    fn: (b, s, e) => {
      let c = 0xffffffff;
      for (let i = s; i < e; i++) c = crcRefl[(c ^ b[i]) & 0xff] ^ (c >>> 8);
      return c >>> 0;
    },
  },
  {
    name: 'crc32-forward',
    fn: (b, s, e) => {
      let c = 0xffffffff;
      for (let i = s; i < e; i++) c = (crcFwd[((c >>> 24) ^ b[i]) & 0xff] ^ (c << 8)) >>> 0;
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

const ranges: { name: string; fn: (t: (typeof tables)[0]) => [number, number] }[] = [
  { name: 'whole table', fn: (t) => [t.start, t.end] },
  { name: 'header only', fn: (t) => [t.start, t.start + 0x24] },
  { name: 'header before +0x1C', fn: (t) => [t.start, t.start + 0x1c] },
  { name: 'descriptors only', fn: (t) => [t.hdr.fieldsOffset, t.hdr.dataOffset] },
  { name: 'header + descriptors', fn: (t) => [t.start, t.hdr.dataOffset] },
  { name: 'descriptors + data', fn: (t) => [t.hdr.fieldsOffset, t.end] },
  { name: 'after +0x20', fn: (t) => [t.start + 0x20, t.end] },
  {
    name: 'data (current)',
    fn: (t) => [t.hdr.dataOffset, t.hdr.dataOffset + t.hdr.currentRecords * t.hdr.recordLenBytes],
  },
];

console.log('\n=== RESIDUAL TEST (looking for a CONSTANT offset across all 82 tables) ===');
let hit = false;
for (const r of ranges) {
  for (const a of algos) {
    const xors = new Set<number>();
    const subs = new Set<number>();
    let ok = true;
    for (const t of tables) {
      const [s, e] = r.fn(t);
      if (s < 0 || e > buf.length || e < s) {
        ok = false;
        break;
      }
      const c = a.fn(buf, s, e);
      xors.add((t.hdr.checksum ^ c) >>> 0);
      subs.add((t.hdr.checksum - c) >>> 0);
    }
    if (!ok) continue;
    if (xors.size === 1) {
      console.log(`  *** ${a.name} over ${r.name}: stored = computed XOR ${hex([...xors][0])}`);
      hit = true;
    }
    if (subs.size === 1) {
      console.log(`  *** ${a.name} over ${r.name}: stored = computed + ${hex([...subs][0])}`);
      hit = true;
    }
    // Near-misses are worth seeing: a handful of outliers may just be tables
    // the game rewrote at a different time.
    if (xors.size > 1 && xors.size <= 3) {
      console.log(`  near: ${a.name} over ${r.name}: only ${xors.size} distinct XOR residuals`);
    }
  }
}
if (!hit) console.log('  no constant residual found');

// ---------------------------------------------------------------------------
// 3. Is the value perhaps not derived at all? Check for ordering/uniqueness
//    patterns that would suggest an ID or timestamp instead.
// ---------------------------------------------------------------------------
console.log('\n=== DOES IT LOOK DERIVED OR ARBITRARY? ===');
const vals = tables.map((t) => t.hdr.checksum);
const byteFreq = new Array(256).fill(0);
for (const v of vals) {
  byteFreq[v & 0xff]++;
  byteFreq[(v >>> 8) & 0xff]++;
  byteFreq[(v >>> 16) & 0xff]++;
  byteFreq[(v >>> 24) & 0xff]++;
}
const used = byteFreq.filter((c) => c > 0).length;
console.log(`  ${used}/256 distinct byte values appear across the 82 values (uniform-ish = hash-like)`);
const ascending = vals.every((v, i) => i === 0 || v >= vals[i - 1]);
console.log(`  ascending in table order: ${ascending} (true would suggest a counter/timestamp)`);
const topByte = new Set(vals.map((v) => v >>> 24)).size;
console.log(`  ${topByte} distinct high bytes (a timestamp would cluster into very few)`);
