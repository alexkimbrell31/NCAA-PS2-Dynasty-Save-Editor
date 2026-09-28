/**
 * Is TOC_BASE derivable from tableCount, or is 0x2B0 a magic number?
 * This decides whether the parser can open a file with a DIFFERENT table
 * count -- e.g. a roster file -- without a hand edit.
 */
import { readSaveFile, parseFileHeader, TOC_OFFSET, TOC_BASE } from '../lib/eadb.ts';

const buf = readSaveFile();
const h = parseFileHeader(buf);

const tocEnd = TOC_OFFSET + h.tableCount * 8;
const align16 = Math.ceil(tocEnd / 16) * 16;
const align64 = Math.ceil(tocEnd / 64) * 64;
const align256 = Math.ceil(tocEnd / 256) * 256;

console.log(`tableCount        ${h.tableCount}`);
console.log(`TOC_OFFSET        0x${TOC_OFFSET.toString(16)}`);
console.log(`TOC ends at       0x${tocEnd.toString(16)} (${tocEnd})`);
console.log(`TOC_BASE actual   0x${TOC_BASE.toString(16)} (${TOC_BASE})`);
console.log('');
console.log(`aligned to 16     0x${align16.toString(16)}  ${align16 === TOC_BASE ? 'MATCH' : 'no'}`);
console.log(`aligned to 64     0x${align64.toString(16)}  ${align64 === TOC_BASE ? 'MATCH' : 'no'}`);
console.log(`aligned to 256    0x${align256.toString(16)}  ${align256 === TOC_BASE ? 'MATCH' : 'no'}`);
console.log(`slack bytes       ${TOC_BASE - tocEnd}`);

// what is actually in the gap?
const gap = buf.subarray(tocEnd, TOC_BASE);
console.log(`gap contents      ${gap.toString('hex')}`);
console.log(`gap all zero?     ${gap.every(b => b === 0)}`);

console.log('\n--- header dwords, for comparison against any other DB file ---');
for (let o = 0; o < 0x18; o += 4) {
  console.log(`  +0x${o.toString(16).padStart(2, '0')}  0x${buf.readUInt32LE(o).toString(16).padStart(8, '0')}  ${buf.readUInt32LE(o)}`);
}
