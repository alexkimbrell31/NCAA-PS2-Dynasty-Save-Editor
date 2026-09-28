/**
 * BOWL pass 3.
 *
 * Two candidates left over from pass 2:
 *   BMFD -- is it a STAD *row index* rather than a STAD.SGID? That would
 *           explain why it sits in the same numeric range as SGID, equals
 *           SGID+1 most of the time, and yet resolves to the wrong stadium.
 *   UTID -- values are 1,2,4,6,7,10,13..38,79,80: distinct, sparse, and the
 *           bowl they sit on has nothing to do with the team of that TGID.
 *           Check it against the full-file table list instead.
 */
import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
const load = (name: string) => {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return readRecords(buf, h, f);
};

const bowl = load('BOWL');
const stad = load('STAD');

// --- BMFD as a STAD row index ----------------------------------------------
console.log('=== BMFD read as a STAD row index ===');
let asRowIndex = 0;
for (const b of bowl) {
  const row = stad[num(b.BMFD)];
  const own = stad.find((s) => num(s.SGID) === num(b.SGID));
  const ok = row !== undefined && own !== undefined && num(row.SGID) === num(own.SGID);
  if (ok) asRowIndex++;
  else
    console.log(
      `  MISS ${String(b.BNME).padEnd(24)} BMFD=${String(num(b.BMFD)).padStart(3)} -> ` +
        `row ${row ? String(row.SNAM) : 'out of range'}; venue is ${own ? String(own.SNAM) : 'no STAD row'}`,
    );
}
console.log(`BMFD == row index of the bowl's own stadium: ${asRowIndex}/34`);

// --- BMFD offset from SGID, grouped ----------------------------------------
console.log('\n=== BMFD - SGID by bowl (sorted) ===');
for (const b of [...bowl].sort((a, c) => num(a.BMFD) - num(c.BMFD))) {
  console.log(
    `  BMFD=${String(num(b.BMFD)).padStart(3)} SGID=${String(num(b.SGID)).padStart(3)} ` +
      `diff=${String(num(b.BMFD) - num(b.SGID)).padStart(4)}  ${String(b.BNME)}`,
  );
}

// --- UTID gaps --------------------------------------------------------------
const utids = bowl.map((b) => num(b.UTID)).sort((a, b) => a - b);
console.log(`\nUTID values: ${utids.join(',')}`);
console.log(
  `missing below the max: ${[...Array(Math.max(...utids) + 1).keys()]
    .filter((i) => i > 0 && !utids.includes(i))
    .join(',')}`,
);
