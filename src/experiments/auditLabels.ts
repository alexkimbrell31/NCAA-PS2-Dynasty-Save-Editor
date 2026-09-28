/**
 * Label audit, part 1: the PLAY table's rating and body-measurement fields.
 *
 * Motivation: TEAM.TMAA was labelled "stadium capacity" on evidence that was
 * true but that an equally good competing hypothesis ("average attendance")
 * explained just as well. This script re-tests the older labels by asking, for
 * each one, whether a DISCRIMINATING test exists -- a test the wrong answer
 * would fail -- rather than merely a consistent one.
 *
 * Two families are at risk:
 *   1. PWGT = lb - 160. The offset was never pinned against ground truth. An
 *      offset of 150 or 170 would produce an equally "plausible" range.
 *   2. The 19 rating names, which came from 4-letter mnemonics. A mnemonic is
 *      suggestive but it is not evidence; PCTH/PCAR or PACC/PAGI could be
 *      swapped and nothing so far would have caught it.
 */

import {
  PLAYER_POSITIONS,
  RATING_FIELDS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  ratingToDisplay,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
function load(name: string) {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  return readRecords(buf, h, parseFieldDescriptors(buf, h));
}
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const play = load('PLAY');
const POS = PLAYER_POSITIONS;
const byPos = new Map<number, typeof play>();
for (const p of play) {
  const k = n(p.PPOS);
  if (!byPos.has(k)) byPos.set(k, []);
  byPos.get(k)!.push(p);
}

console.log('================ AUDIT 1: PWGT offset ================\n');
console.log('Claim: PWGT stores (pounds - 160).');
console.log('Competing: any other offset. 150 and 170 give equally "plausible" ranges.');
console.log('Discriminating test: real 2006 college positional weight averages are');
console.log('published. A wrong offset shifts EVERY position by the same amount, so');
console.log('the residual pattern identifies the true offset.\n');

// Published approximate FBS positional averages, mid-2000s.
const REAL_WEIGHT: Record<string, number> = {
  QB: 215, HB: 205, FB: 240, WR: 190, TE: 250,
  LT: 305, LG: 305, C: 295, RG: 305, RT: 305,
  LE: 270, RE: 270, DT: 295,
  LOLB: 230, MLB: 240, ROLB: 230,
  CB: 185, FS: 200, SS: 205,
  K: 190, P: 195,
};

for (const offset of [150, 155, 160, 165, 170]) {
  let sumAbs = 0;
  let count = 0;
  for (const [posIdx, players] of byPos) {
    const name = POS[posIdx];
    const real = REAL_WEIGHT[name];
    if (real === undefined) continue;
    const got = mean(players.map((p) => n(p.PWGT) + offset));
    sumAbs += Math.abs(got - real);
    count++;
  }
  console.log(
    `  offset ${offset}: mean |modelled - real| across ${count} positions = ` +
      `${(sumAbs / count).toFixed(1)} lb`,
  );
}

console.log('\n  Per-position detail at the claimed offset of 160:');
console.log('    pos    n     model   real   diff');
for (const [posIdx, players] of [...byPos.entries()].sort((a, b) => a[0] - b[0])) {
  const name = POS[posIdx];
  const real = REAL_WEIGHT[name];
  if (real === undefined) continue;
  const got = mean(players.map((p) => n(p.PWGT) + 160));
  console.log(
    `    ${name.padEnd(5)} ${String(players.length).padStart(4)}  ` +
      `${got.toFixed(0).padStart(6)} ${String(real).padStart(6)} ` +
      `${(got - real >= 0 ? '+' : '') + (got - real).toFixed(0)}`,
  );
}

console.log('\n================ AUDIT 2: rating field names ================\n');
console.log('Claim: the 19 RATING_FIELDS names decoded from their mnemonics.');
console.log('Competing: any permutation of the names across the same 19 fields.');
console.log('Discriminating test: each rating has a position that MUST lead it.');
console.log('If the label is right the predicted position tops the table; if two');
console.log('labels were swapped, both predictions fail.\n');

// For each rating, the positions that must rank at or near the top, and the
// positions that must rank at the bottom. These come from how football works,
// not from the save file.
const EXPECT: Record<string, { top: string[]; bottom: string[] }> = {
  PSPD: { top: ['CB', 'WR'], bottom: ['LT', 'LG', 'C', 'RG', 'RT'] },
  PACC: { top: ['CB', 'WR'], bottom: ['LT', 'LG', 'C', 'RG', 'RT'] },
  PAGI: { top: ['CB', 'WR', 'FS'], bottom: ['LT', 'LG', 'C', 'RG', 'RT'] },
  PSTR: { top: ['LT', 'LG', 'C', 'RG', 'RT', 'DT'], bottom: ['K', 'P', 'CB', 'WR'] },
  PTHP: { top: ['QB'], bottom: ['LT', 'C', 'DT'] },
  PTHA: { top: ['QB'], bottom: ['LT', 'C', 'DT'] },
  PKPR: { top: ['K', 'P'], bottom: ['LT', 'C', 'DT'] },
  PKAC: { top: ['K', 'P'], bottom: ['LT', 'C', 'DT'] },
  PCTH: { top: ['WR', 'TE'], bottom: ['LT', 'LG', 'C', 'RG', 'RT'] },
  PCAR: { top: ['HB', 'FB'], bottom: ['LT', 'C', 'DT'] },
  PBTK: { top: ['HB', 'FB'], bottom: ['K', 'P'] },
  PTAK: { top: ['MLB', 'LOLB', 'ROLB', 'SS'], bottom: ['K', 'P', 'WR'] },
  PPBK: { top: ['LT', 'RT', 'LG', 'RG', 'C'], bottom: ['K', 'P', 'CB', 'WR'] },
  PRBK: { top: ['LT', 'RT', 'LG', 'RG', 'C', 'TE'], bottom: ['K', 'P', 'CB'] },
  PJMP: { top: ['WR', 'CB', 'FS'], bottom: ['LT', 'C', 'RG'] },
};

const rank = (field: string) =>
  [...byPos.entries()]
    .filter(([, ps]) => ps.length >= 20)
    .map(([posIdx, ps]) => ({
      pos: POS[posIdx],
      avg: mean(ps.map((p) => ratingToDisplay(n(p[field])))),
    }))
    .sort((a, b) => b.avg - a.avg);

let pass = 0;
let fail = 0;
for (const field of RATING_FIELDS) {
  const exp = EXPECT[field];
  const table = rank(field);
  if (!exp) {
    console.log(
      `  ${field}: no independent prediction available. ` +
        `top=${table.slice(0, 3).map((r) => r.pos).join(',')}`,
    );
    continue;
  }
  const top5 = table.slice(0, 5).map((r) => r.pos);
  const bottom5 = table.slice(-5).map((r) => r.pos);
  const topHit = exp.top.some((p) => top5.includes(p));
  const botHit = exp.bottom.some((p) => bottom5.includes(p));
  const ok = topHit && botHit;
  if (ok) pass++;
  else fail++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'} ${field}: top=${top5.slice(0, 4).join(',')} ` +
      `| bottom=${bottom5.slice(-3).join(',')}` +
      (ok ? '' : `   expected top ${exp.top.join('/')}`),
  );
}
console.log(`\n  ${pass} ratings behave as labelled, ${fail} do not.`);

// The pair most at risk of being swapped: catching vs carrying, and
// acceleration vs agility. Check them head to head.
console.log('\n  Head-to-head on the most swappable pairs:');
for (const [a, b, who] of [
  ['PCTH', 'PCAR', 'WR should lead catching; HB should lead carrying'],
  ['PTHP', 'PTHA', 'both QB; power should spread wider than accuracy'],
  ['PKPR', 'PKAC', 'both K/P'],
] as const) {
  const ra = rank(a);
  const rb = rank(b);
  console.log(`    ${a} top: ${ra.slice(0, 3).map((r) => `${r.pos}(${r.avg.toFixed(0)})`).join(' ')}`);
  console.log(`    ${b} top: ${rb.slice(0, 3).map((r) => `${r.pos}(${r.avg.toFixed(0)})`).join(' ')}`);
  console.log(`      -> ${who}\n`);
}

console.log('================ AUDIT 3: PHGT ================\n');
console.log('Claim: PHGT is height in inches.');
console.log('Competing: inches-with-an-offset, or centimetres.');
console.log('Test: positional height ordering plus absolute plausibility.\n');
const REAL_HEIGHT: Record<string, number> = {
  QB: 74, HB: 71, FB: 72, WR: 73, TE: 76,
  LT: 77, LG: 76, C: 75, RG: 76, RT: 77,
  LE: 76, RE: 76, DT: 75,
  LOLB: 74, MLB: 73, ROLB: 74,
  CB: 71, FS: 72, SS: 72,
  K: 72, P: 73,
};
for (const offset of [-2, 0, 2]) {
  let sumAbs = 0;
  let count = 0;
  for (const [posIdx, players] of byPos) {
    const real = REAL_HEIGHT[POS[posIdx]];
    if (real === undefined) continue;
    sumAbs += Math.abs(mean(players.map((p) => n(p.PHGT) + offset)) - real);
    count++;
  }
  console.log(`  PHGT + ${String(offset).padStart(2)}: mean error ${(sumAbs / count).toFixed(2)} in`);
}
const tallest = [...byPos.entries()]
  .filter(([, ps]) => ps.length >= 20)
  .map(([i, ps]) => ({ pos: POS[i], h: mean(ps.map((p) => n(p.PHGT))) }))
  .sort((a, b) => b.h - a.h);
console.log(
  `  tallest positions: ${tallest.slice(0, 4).map((r) => `${r.pos}(${r.h.toFixed(1)}")`).join(' ')}`,
);
console.log(
  `  shortest positions: ${tallest.slice(-3).map((r) => `${r.pos}(${r.h.toFixed(1)}")`).join(' ')}`,
);
