/**
 * Two questions that decide how much work a PLAY bulk-edit really is:
 *   1. Is DCHT.ddep a rating-ordered depth chart? (does it need re-sorting?)
 *   2. Is POVR DERIVED from the other ratings? (does it need recomputing?)
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, playerTeam, RATING_FIELDS,
  PLAYER_POSITIONS, ratingToDisplay,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, rows: readRecords(buf, h, f) as any[] };
};
const play = load('PLAY'), dcht = load('DCHT');
const byPgid = new Map(play.rows.map(p => [p.PGID, p]));

console.log('=== 1. DCHT.ddep -- is it depth order by rating? ===');
const groups = new Map<string, any[]>();
for (const r of dcht.rows) {
  const k = `${playerTeam(r.PGID)}|${r.PPOS}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(r);
}
let ok = 0, tot = 0, ddepDense = 0;
for (const [, rows] of groups) {
  if (rows.length < 2) continue;
  tot++;
  const sorted = [...rows].sort((a, b) => a.ddep - b.ddep);
  const ratings = sorted.map(r => byPgid.get(r.PGID)?.POVR ?? 0);
  if (ratings.every((v, i) => i === 0 || ratings[i - 1] >= v)) ok++;
  const deps = sorted.map(r => r.ddep);
  if (deps.every((v, i) => v === i)) ddepDense++;
}
console.log(`  groups where ddep order == POVR descending: ${ok}/${tot}`);
console.log(`  groups where ddep is dense 0..n-1:          ${ddepDense}/${tot}`);
console.log(`  ddep range: ${Math.min(...dcht.rows.map(r => r.ddep))}..${Math.max(...dcht.rows.map(r => r.ddep))}`);

// Does DCHT cover every player?
const dchtPgids = new Set(dcht.rows.map(r => r.PGID));
console.log(`  PLAY players present in DCHT: ${play.rows.filter(p => dchtPgids.has(p.PGID)).length}/${play.rows.length}`);
const dup = dcht.rows.length - dchtPgids.size;
console.log(`  DCHT rows ${dcht.rows.length}, distinct PGID ${dchtPgids.size} (${dup} players listed at 2+ spots)`);

console.log('\n=== 2. is POVR derived from the other ratings? ===');
// Per position, fit POVR ~ weighted mean of ratings. If POVR is derived,
// a simple per-position linear model should fit very well.
const ratingNames = RATING_FIELDS.filter((r: string) => r !== 'POVR');
console.log(`  candidate inputs: ${ratingNames.join(' ')}`);

for (let pos = 0; pos < 21; pos++) {
  const players = play.rows.filter(p => p.PPOS === pos);
  if (players.length < 40) continue;
  // best single-rating correlation, and correlation of the simple mean
  const corr = (a: number[], b: number[]) => {
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  };
  const y = players.map(p => ratingToDisplay(p.POVR));
  let best = '', bestC = 0;
  for (const rn of ratingNames) {
    const c = corr(players.map(p => ratingToDisplay(p[rn])), y);
    if (Math.abs(c) > Math.abs(bestC)) { bestC = c; best = rn; }
  }
  const meanAll = players.map(p => ratingNames.reduce((s, rn) => s + ratingToDisplay(p[rn]), 0) / ratingNames.length);
  console.log(`  ${PLAYER_POSITIONS[pos].padEnd(4)} n=${String(players.length).padStart(4)}  ` +
    `best single: ${best.padEnd(5)} r=${bestC.toFixed(3)}   mean-of-all r=${corr(meanAll, y).toFixed(3)}`);
}

console.log('\n--- exact test: do two players with IDENTICAL ratings share POVR? ---');
const key = (p: any) => `${p.PPOS}|` + ratingNames.map(rn => p[rn]).join(',');
const sameRatings = new Map<string, any[]>();
for (const p of play.rows) {
  const k = key(p);
  if (!sameRatings.has(k)) sameRatings.set(k, []);
  sameRatings.get(k)!.push(p);
}
let pairs = 0, agree = 0;
for (const [, ps] of sameRatings) {
  if (ps.length < 2) continue;
  for (let i = 1; i < ps.length; i++) { pairs++; if (ps[i].POVR === ps[0].POVR) agree++; }
}
console.log(`  players sharing an identical rating vector: ${pairs} pairs`);
console.log(`  of those, POVR also identical: ${agree}/${pairs}`);
console.log(pairs === 0
  ? '  (no duplicates -- cannot test this way)'
  : agree === pairs
    ? '  => POVR is a deterministic FUNCTION of the ratings (+position). Must recompute on edit.'
    : '  => POVR is NOT fully determined by the ratings; it is stored independently.');
