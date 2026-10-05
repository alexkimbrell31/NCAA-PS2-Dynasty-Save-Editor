// Diff two save files: raw byte deltas, per-table header dword movement,
// and field-level attribution of every changed value.
//
//   node src/experiments/diffSaves.ts <fileA> <fileB>

import fs from 'node:fs';
import {
  parseFileHeader,
  parseToc,
  parseTableHeader,
  parseFieldDescriptors,
  readRecords,
  hex,
} from '../lib/eadb.ts';

const [, , pathA, pathB] = process.argv;
if (!pathA || !pathB) {
  console.error('usage: node src/experiments/diffSaves.ts <fileA> <fileB>');
  process.exit(1);
}

const a = fs.readFileSync(pathA);
const b = fs.readFileSync(pathB);

console.log(`A ${pathA}  ${a.length} bytes`);
console.log(`B ${pathB}  ${b.length} bytes`);
if (a.length !== b.length) {
  console.log('LENGTHS DIFFER — aborting structural diff');
  process.exit(1);
}

// ---------------------------------------------------------------- raw diff
const diffs: number[] = [];
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
console.log(`\n=== RAW ===\n${diffs.length} differing byte(s)`);

// group into runs
const runs: Array<{ start: number; end: number }> = [];
for (const off of diffs) {
  const last = runs[runs.length - 1];
  if (last && off <= last.end + 4) last.end = off;
  else runs.push({ start: off, end: off });
}
console.log(`${runs.length} run(s)`);

// ------------------------------------------------------------- structure
const hA = parseFileHeader(a);
const hB = parseFileHeader(b);
const tocA = parseToc(a, hA);
const tocB = parseToc(b, hB);

console.log('\n=== FILE HEADER ===');
for (const k of Object.keys(hA) as Array<keyof typeof hA>) {
  const va = hA[k];
  const vb = hB[k];
  const mark = va === vb ? '    ' : ' ** ';
  console.log(`${mark}${String(k).padEnd(16)} ${va}  ->  ${vb}`);
}
console.log('  file +0x14 dword:');
console.log(`    A ${hex(a.readUInt32LE(0x14))}   B ${hex(b.readUInt32LE(0x14))}` +
  (a.readUInt32LE(0x14) === b.readUInt32LE(0x14) ? '   (same)' : '   ** MOVED **'));

// which run belongs to which table
function ownerOf(off: number): string {
  for (let i = 0; i < tocA.length; i++) {
    const t = tocA[i];
    const next = tocA[i + 1];
    const end = next ? next.realOffset : a.length;
    if (off >= t.realOffset && off < end) return t.name;
  }
  return off < tocA[0].realOffset ? '<file header/TOC>' : '<trailing>';
}

console.log('\n=== TABLE HEADER DWORD (+0x1C) ===');
const movedDword: string[] = [];
const movedOtherHeader: string[] = [];
for (const t of tocA) {
  const off = t.realOffset + 0x1c;
  const va = a.readUInt32LE(off);
  const vb = b.readUInt32LE(off);
  if (va !== vb) {
    movedDword.push(t.name);
    console.log(` ** ${t.name}  ${hex(va)} -> ${hex(vb)}`);
  }
  // any other header byte changed?
  for (let i = 0; i < 0x24; i++) {
    if (i >= 0x1c && i < 0x20) continue;
    if (a[t.realOffset + i] !== b[t.realOffset + i]) {
      movedOtherHeader.push(`${t.name}+${hex(i, 2)}`);
      break;
    }
  }
}
console.log(`${movedDword.length} of ${tocA.length} table dwords moved`);
if (movedOtherHeader.length)
  console.log(`other header bytes changed: ${movedOtherHeader.join(', ')}`);

console.log('\n=== RUNS BY OWNER ===');
const byOwner = new Map<string, number>();
for (const r of runs) {
  const o = ownerOf(r.start);
  byOwner.set(o, (byOwner.get(o) ?? 0) + 1);
}
for (const [o, n] of [...byOwner].sort((x, y) => y[1] - x[1]))
  console.log(`  ${o.padEnd(20)} ${n} run(s)`);

// -------------------------------------------------------- field-level diff
console.log('\n=== FIELD-LEVEL ===');
let changedValues = 0;
const changedTables = new Set<string>();
for (const t of tocA) {
  let tA, tB, fA, fB, rA, rB;
  try {
    tA = parseTableHeader(a, t.realOffset);
    tB = parseTableHeader(b, t.realOffset);
    fA = parseFieldDescriptors(a, tA);
    fB = parseFieldDescriptors(b, tB);
    rA = readRecords(a, tA, fA);
    rB = readRecords(b, tB, fB);
  } catch (e) {
    console.log(`  ${t.name}: parse error ${(e as Error).message}`);
    continue;
  }
  const n = Math.min(rA.length, rB.length);
  for (let i = 0; i < n; i++) {
    for (const f of fA) {
      const va = rA[i][f.name];
      const vb = rB[i][f.name];
      if (va !== vb) {
        changedValues++;
        changedTables.add(t.name);
        if (changedValues <= 60)
          console.log(`  ${t.name}[${i}].${f.name}: ${JSON.stringify(va)} -> ${JSON.stringify(vb)}`);
      }
    }
  }
}
console.log(`${changedValues} field value(s) differ across ${changedTables.size} table(s)`);
if (changedValues > 60) console.log('(first 60 shown)');

// ------------------------------------------------- differential signature
console.log('\n=== DELTA SIGNATURE ===');
for (const name of movedDword) {
  const t = tocA.find((x) => x.name === name)!;
  const va = a.readUInt32LE(t.realOffset + 0x1c);
  const vb = b.readUInt32LE(t.realOffset + 0x1c);
  console.log(`  ${name}: XOR ${hex(va ^ vb)}  SUB ${hex((vb - va) >>> 0)}`);
}
const fa = a.readUInt32LE(0x14);
const fb = b.readUInt32LE(0x14);
if (fa !== fb)
  console.log(`  <file>: XOR ${hex(fa ^ fb)}  SUB ${hex((fb - fa) >>> 0)}`);
