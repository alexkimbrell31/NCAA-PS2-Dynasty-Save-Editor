/**
 * STAD pass 1.
 *
 * Three fields are candidate keys (SGID, SORD and SRES all have 238 distinct
 * values across 238 rows), so the first job is working out which one TEAM.SGID
 * actually joins on -- picking the wrong one would still "work" for a while.
 *
 * The prize here is SCAP: TEAM.TMAA was already validated as stadium capacity
 * from the team side, so the two tables should agree independently.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
  teamName,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
function load(name: string) {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  return readRecords(buf, h, parseFieldDescriptors(buf, h));
}
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);
const s = (v: number | string) => (typeof v === 'string' ? v : '');

const stad = load('STAD');
const team = load('TEAM');
const play = load('PLAY');

const fbs = new Set(play.map((p) => playerTeam(n(p.PGID))));
const fbsTeams = team.filter((t) => fbs.has(n(t.TGID)));

console.log(`STAD: ${stad.length} stadiums\n`);

// --- which field is the join key? ------------------------------------------
console.log('=== Candidate keys vs TEAM.SGID ===');
const wanted = new Set(fbsTeams.map((t) => n(t.SGID)));
for (const f of ['SGID', 'SORD', 'SRES', 'STID']) {
  const have = new Set(stad.map((r) => n(r[f])));
  const hit = [...wanted].filter((v) => have.has(v)).length;
  console.log(
    `  ${f}: ${have.size} distinct, range ${Math.min(...have)}..${Math.max(...have)}, ` +
      `covers ${hit}/${wanted.size} of the FBS TEAM.SGID values`,
  );
}

// The decisive test: join on each candidate and see whether the stadium's
// school name (TDNA) matches the team's school name (also TDNA).
console.log('\n=== Name agreement after joining (the real test) ===');
for (const f of ['SGID', 'SORD', 'SRES']) {
  const byKey = new Map(stad.map((r) => [n(r[f]), r]));
  let match = 0;
  let checked = 0;
  const misses: string[] = [];
  for (const t of fbsTeams) {
    const st = byKey.get(n(t.SGID));
    if (!st) continue;
    checked++;
    if (s(st.TDNA) === s(t.TDNA)) match++;
    else if (misses.length < 5) misses.push(`${s(t.TDNA)} -> ${s(st.TDNA)}`);
  }
  console.log(`  join on ${f}: ${match}/${checked} school names agree`);
  if (misses.length) console.log(`    e.g. ${misses.join(', ')}`);
}

// --- capacity cross-check --------------------------------------------------
console.log('\n=== SCAP vs TEAM.TMAA (independent capacity check) ===');
const byGid = new Map(stad.map((r) => [n(r.SGID), r]));
let exact = 0;
let close = 0;
const capMisses: string[] = [];
for (const t of fbsTeams) {
  const st = byGid.get(n(t.SGID));
  if (!st) continue;
  const a = n(t.TMAA);
  const b = n(st.SCAP);
  if (a === b) exact++;
  else {
    if (Math.abs(a - b) / Math.max(a, b) < 0.05) close++;
    if (capMisses.length < 10) capMisses.push(`${s(t.TDNA)}: TEAM=${a} STAD=${b}`);
  }
}
console.log(`  exact matches: ${exact}/${fbsTeams.length}`);
console.log(`  within 5%: ${close}`);
if (capMisses.length) {
  console.log('  mismatches:');
  for (const m of capMisses) console.log(`    ${m}`);
}

// --- string fields ---------------------------------------------------------
console.log('\n=== String fields ===');
for (const f of ['TDNA', 'SSTA', 'SNAM', 'STNN', 'SCIT']) {
  const vals = stad.map((r) => s(r[f]));
  const nonEmpty = vals.filter((v) => v.length > 0);
  console.log(
    `  ${f}: ${nonEmpty.length}/${vals.length} non-empty, ` +
      `${new Set(nonEmpty).size} distinct; e.g. ${[...new Set(nonEmpty)].slice(0, 4).map((v) => `"${v}"`).join(', ')}`,
  );
}

console.log('\n  Stadium nicknames (STNN):');
for (const r of stad.filter((x) => s(x.STNN).length > 0)) {
  console.log(`    ${s(r.SNAM).padEnd(32)} "${s(r.STNN)}"  (${s(r.TDNA)})`);
}

console.log('\n  SSTA distinct values (should be US state codes):');
const states = [...new Set(stad.map((r) => s(r.SSTA)).filter(Boolean))].sort();
console.log(`    ${states.join(' ')}  (${states.length} states)`);
const allTwo = states.every((v) => /^[A-Z]{2}$/.test(v));
console.log(`    all two-letter uppercase? ${allTwo}`);

// STID vs SSTA -- is STID just a state index?
console.log('\n=== STID vs SSTA ===');
const stidToState = new Map<number, Set<string>>();
for (const r of stad) {
  const k = n(r.STID);
  if (!stidToState.has(k)) stidToState.set(k, new Set());
  stidToState.get(k)!.add(s(r.SSTA));
}
const oneToOne = [...stidToState.values()].every((v) => v.size === 1);
console.log(`  STID distinct=${stidToState.size}, SSTA distinct=${states.length}`);
console.log(`  every STID maps to exactly one state? ${oneToOne}`);
console.log(
  '  sample: ' +
    [...stidToState.entries()].sort((a, b) => a[0] - b[0]).slice(0, 10).map(([k, v]) => `${k}=${[...v][0]}`).join(' '),
);

// --- capacity sanity -------------------------------------------------------
console.log('\n=== SCAP ===');
const caps = stad.map((r) => n(r.SCAP));
console.log(`  range ${Math.min(...caps)}..${Math.max(...caps)}, ${caps.filter((c) => c === 0).length} zeros`);
const top = [...stad].sort((a, b) => n(b.SCAP) - n(a.SCAP)).slice(0, 10);
console.log('  largest:');
for (const r of top) {
  console.log(`    ${String(n(r.SCAP)).padStart(7)}  ${s(r.SNAM).padEnd(34)} ${s(r.TDNA)}`);
}
const zeroCap = stad.filter((r) => n(r.SCAP) === 0);
console.log(`  zero-capacity rows (${zeroCap.length}):`);
for (const r of zeroCap.slice(0, 12)) {
  console.log(`    "${s(r.SNAM)}" / "${s(r.TDNA)}" / "${s(r.SCIT)}"`);
}
