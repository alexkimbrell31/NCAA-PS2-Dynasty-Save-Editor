/**
 * Does the table +0x1C dword depend on RECORD DATA, or only on the table's
 * identity/schema?
 *
 * This is the question that decides how hard the write path is:
 *   - If it depends on data, we must crack the algorithm exactly or the game
 *     rejects every edited save.
 *   - If it is a name or schema hash, it is CONSTANT under field edits and the
 *     write path needs no checksum work at all.
 *
 * A decisive test is available without cracking anything. Several tables hold
 * ZERO records. If their allocated data regions are all-zero bytes, then any
 * data-only checksum must collapse to the same value for all same-length
 * tables. If their +0x1C values differ anyway, data alone cannot explain the
 * field.
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
// 1. Are empty tables' data regions actually zero?
// ---------------------------------------------------------------------------
console.log('=== EMPTY TABLES: IS THE DATA REGION ZEROED? ===');
const empty = tables.filter((t) => t.hdr.currentRecords === 0);
for (const t of empty) {
  const s = t.hdr.dataOffset;
  const e = Math.min(t.end, s + t.hdr.maxRecords * t.hdr.recordLenBytes);
  let nonZero = 0;
  for (let i = s; i < e; i++) if (buf[i] !== 0) nonZero++;
  console.log(
    `${t.name.padEnd(5)} +0x1C=${hex(t.hdr.checksum)} dataBytes=${String(e - s).padStart(6)} ` +
      `nonZero=${nonZero}${nonZero === 0 ? '  <- fully zeroed' : ''}`,
  );
}

const zeroed = empty.filter((t) => {
  const s = t.hdr.dataOffset;
  const e = Math.min(t.end, s + t.hdr.maxRecords * t.hdr.recordLenBytes);
  for (let i = s; i < e; i++) if (buf[i] !== 0) return false;
  return true;
});
console.log(
  `\n${zeroed.length}/${empty.length} empty tables have a fully zeroed data region, ` +
    `and they hold ${new Set(zeroed.map((t) => t.hdr.checksum)).size} distinct +0x1C values.`,
);
if (zeroed.length > 1 && new Set(zeroed.map((t) => t.hdr.checksum)).size === zeroed.length) {
  console.log(
    'CONCLUSION: identical (all-zero) payloads produce DIFFERENT +0x1C values, so the\n' +
      'field cannot be a plain checksum over record data alone. It must incorporate the\n' +
      "table's identity or schema -- or not be a checksum at all.",
  );
}

// ---------------------------------------------------------------------------
// 2. Is it a hash of the 4-character table name?
// ---------------------------------------------------------------------------
console.log('\n=== IS IT A HASH OF THE TABLE NAME? ===');
const nameHashes: { name: string; fn: (s: string) => number }[] = [
  {
    name: 'fnv1a-32',
    fn: (s) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    },
  },
  {
    name: 'fnv1-32',
    fn: (s) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) {
        h = Math.imul(h, 0x01000193);
        h ^= s.charCodeAt(i);
      }
      return h >>> 0;
    },
  },
  {
    name: 'djb2',
    fn: (s) => {
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
      return h >>> 0;
    },
  },
  {
    name: 'djb2-xor',
    fn: (s) => {
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
      return h >>> 0;
    },
  },
  {
    name: 'sdbm',
    fn: (s) => {
      let h = 0;
      for (let i = 0; i < s.length; i++)
        h = (s.charCodeAt(i) + Math.imul(h, 65599) + (h << 6) - h) >>> 0;
      return h >>> 0;
    },
  },
  {
    name: 'jenkins-oaat',
    fn: (s) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = (h + s.charCodeAt(i)) >>> 0;
        h = (h + (h << 10)) >>> 0;
        h ^= h >>> 6;
      }
      h = (h + (h << 3)) >>> 0;
      h ^= h >>> 11;
      return (h + (h << 15)) >>> 0;
    },
  },
];

for (const h of nameHashes) {
  const hits = tables.filter((t) => h.fn(t.name) === t.hdr.checksum).length;
  if (hits > 0) console.log(`  ${h.name}: ${hits}/${tables.length}`);
}
console.log('  (nothing listed above means no name hash matched)');

// ---------------------------------------------------------------------------
// 3. Structural reality check -- dump a full table header
// ---------------------------------------------------------------------------
console.log('\n=== FULL 36-BYTE HEADER DUMP (CONF) ===');
const conf = tables.find((t) => t.name === 'CONF')!;
for (let off = 0; off < 0x24; off += 4) {
  const v = buf.readUInt32LE(conf.start + off);
  console.log(
    `  +0x${off.toString(16).padStart(2, '0')}  ${hex(v)}  ${String(v).padStart(12)}`,
  );
}

// ---------------------------------------------------------------------------
// 4. flags: STAD differs from everything else
// ---------------------------------------------------------------------------
console.log('\n=== FLAGS DISTRIBUTION ===');
const flagCounts = new Map<number, string[]>();
for (const t of tables) {
  if (!flagCounts.has(t.hdr.flags)) flagCounts.set(t.hdr.flags, []);
  flagCounts.get(t.hdr.flags)!.push(t.name);
}
for (const [f, names] of [...flagCounts].sort((a, b) => b[1].length - a[1].length)) {
  console.log(
    `  ${hex(f)}: ${names.length} tables${names.length <= 6 ? ` (${names.join(', ')})` : ''}`,
  );
}

// Does flags correlate with having string fields? Bit 1 vs bit 0 is a plausible
// "record contains variable/aligned data" marker.
console.log('\n  flags vs presence of string (>32 bit) fields:');
for (const [f, names] of flagCounts) {
  let withStrings = 0;
  for (const n of names) {
    const t = tables.find((x) => x.name === n)!;
    let has = false;
    for (let i = 0; i < t.hdr.fieldCount; i++) {
      const off = t.hdr.fieldsOffset + i * 0x10;
      if (buf.readUInt32LE(off + 0x08) > 32) has = true;
    }
    if (has) withStrings++;
  }
  console.log(`    ${hex(f)}: ${withStrings}/${names.length} tables contain a string field`);
}
