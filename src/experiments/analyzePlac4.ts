/**
 * PLAC's values look like CUMULATIVE SNAPSHOTS taken during a game rather than
 * final totals: one of Josh McMillan's rows reads 24 comp / 232 yds / 46 att,
 * which is exactly his final line, while a lower-PAas row reads 10 / 116 / 12,
 * a strict prefix of it.
 *
 * Testable claim: within a (player, PAty) group, ordering by PAas must produce
 * MONOTONICALLY NON-DECREASING values, and the maximum must equal the player's
 * final stat line.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (t: string) => {
  const h = parseTableHeader(buf, findTable(toc, t).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, rows: readRecords(buf, h, f) };
};

const plac = load('PLAC');
const psof = load('PSOF');
const psde = load('PSDE');
const play = load('PLAY');
const byP = new Map(play.rows.map((p) => [n(p.PGID), p]));
const offBy = new Map(psof.rows.map((r) => [n(r.PGID), r]));
const defBy = new Map(psde.rows.map((r) => [n(r.PGID), r]));

// Group by (player, PAty) and sort by PAas.
const groups = new Map<string, Array<Record<string, number | string>>>();
for (const r of plac.rows) {
  const k = `${n(r.PGID)}|${n(r.PAty)}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(r);
}
const multi = [...groups.entries()].filter(([, g]) => g.length > 1);
console.log(`${groups.size} (player, PAty) groups; ${multi.length} have more than one row`);

// Monotonicity by PAas.
for (const col of ['PAsC', 'PAsS', 'PAsV', 'PAcC', 'PAcS', 'PAcV']) {
  let mono = 0;
  for (const [, g] of multi) {
    const s = [...g].sort((a, b) => n(a.PAas) - n(b.PAas));
    if (s.every((r, i) => i === 0 || n(r[col]) >= n(s[i - 1][col]))) mono++;
  }
  console.log(`  ${col} non-decreasing as PAas rises: ${mono}/${multi.length}`);
}

// Also try ordering by GQTR.
console.log('\nSame test ordering by GQTR instead:');
for (const col of ['PAsC', 'PAsS', 'PAsV']) {
  let mono = 0;
  for (const [, g] of multi) {
    const s = [...g].sort((a, b) => n(a.GQTR) - n(b.GQTR));
    if (s.every((r, i) => i === 0 || n(r[col]) >= n(s[i - 1][col]))) mono++;
  }
  console.log(`  ${col} non-decreasing as GQTR rises: ${mono}/${multi.length}`);
}

// Does the MAX equal the final line? Test passing groups (PAty 2/3).
console.log('\nDoes max(PLAC) equal the final PSOF line? (passing, PAty 2 and 3)');
for (const [col, statField, label] of [
  ['PAsC', 'sacm', 'completions'],
  ['PAsS', 'saya', 'passing yards'],
  ['PAsV', 'saat', 'attempts'],
] as const) {
  let ok = 0;
  let tot = 0;
  let under = 0;
  for (const [k, g] of groups) {
    const ty = Number(k.split('|')[1]);
    if (ty !== 2 && ty !== 3) continue;
    const pgid = Number(k.split('|')[0]);
    const o = offBy.get(pgid);
    if (!o) continue;
    tot++;
    const mx = Math.max(...g.map((r) => n(r[col])));
    if (mx === n(o[statField])) ok++;
    else if (mx < n(o[statField])) under++;
  }
  console.log(
    `  max(${col}) == ${statField}: ${ok}/${tot}  (${under} fall short, ` +
      `${tot - ok - under} overshoot)`,
  );
}

// Defensive groups: PAty 8/9
console.log('\nSame for defence (PAty 8 and 9):');
for (const [col, statField] of [
  ['PAsS', 'slsk'],
  ['PAcS', 'ssin'],
  ['PAsV', 'sdtl'],
  ['PAcC', 'slff'],
] as const) {
  let ok = 0;
  let tot = 0;
  for (const [k, g] of groups) {
    const ty = Number(k.split('|')[1]);
    if (ty !== 8 && ty !== 9) continue;
    const d = defBy.get(Number(k.split('|')[0]));
    if (!d) continue;
    tot++;
    if (Math.max(...g.map((r) => n(r[col]))) === n(d[statField])) ok++;
  }
  console.log(`  max(${col}) == ${statField}: ${ok}/${tot}`);
}

// Show one multi-row group in full.
const ex = multi.find(([k, g]) => g.length >= 3 && Number(k.split('|')[1]) === 3);
if (ex) {
  const pgid = Number(ex[0].split('|')[0]);
  const nm = playerName(byP.get(pgid)!);
  const o = offBy.get(pgid);
  console.log(`\nExample: ${nm.first} ${nm.last}, PAty 3`);
  for (const r of [...ex[1]].sort((a, b) => n(a.PAas) - n(b.PAas))) {
    console.log(
      `  PAas ${String(n(r.PAas)).padStart(2)} GQTR ${n(r.GQTR)}  ` +
        `comp ${String(n(r.PAsC)).padStart(3)} yds ${String(n(r.PAsS)).padStart(4)} ` +
        `att ${String(n(r.PAsV)).padStart(3)}`,
    );
  }
  if (o) console.log(`  FINAL (PSOF): comp ${n(o.sacm)} yds ${n(o.saya)} att ${n(o.saat)}`);
}
