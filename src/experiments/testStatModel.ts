/**
 * Test the PSOF/PSDE naming model WITHOUT relying on the mnemonics.
 *
 * The model says s + category + stat, with a = pAssing, c = reCeiving,
 * u = rUshing. That is exactly the mnemonic-grade reasoning Lesson 8 warns
 * about, so it has to be tested against something the game actually computed.
 *
 * Three independent kinds of evidence, in increasing strength:
 *   1. POSITION GATING -- if sa** is passing, QBs should own it and receivers
 *      should not. Weak on its own (many splits look like this).
 *   2. ARITHMETIC INVARIANTS -- completions <= attempts, TD <= completions,
 *      long <= total. These must hold for the RIGHT pairing and will usually
 *      break for a wrong one.
 *   3. TEAM AGGREGATION -- for one game, the sum of every receiver's receiving
 *      yards must equal the sum of every passer's passing yards. This is a real
 *      identity in football and has nothing to do with what the fields are
 *      named. It is the discriminating test.
 */

import {
  PLAYER_POSITIONS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
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

const psof = load('PSOF');
const psde = load('PSDE');
const play = load('PLAY');
const schd = load('SCHD');
const team = load('TEAM');
const byP = new Map(play.rows.map((p) => [n(p.PGID), p]));
const tn = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));
const pos = (pgid: number) => PLAYER_POSITIONS[n(byP.get(pgid)!.PPOS)] ?? '?';

// ---------------------------------------------------------------- 1. gating
console.log('=== POSITION GATING: which positions own each PSOF column? ===');
const offFields = psof.f.map((f) => f.name).filter((f) => !['PGID', 'SEYR', 'sgmp'].includes(f));
for (const f of offFields) {
  const nz = psof.rows.filter((r) => n(r[f]) !== 0);
  if (!nz.length) continue;
  const byPos = new Map<string, number>();
  for (const r of nz) byPos.set(pos(n(r.PGID)), (byPos.get(pos(n(r.PGID))) ?? 0) + 1);
  const top = [...byPos].sort((a, b) => b[1] - a[1]);
  const share = ((top[0][1] / nz.length) * 100).toFixed(0);
  console.log(
    `  ${f.padEnd(5)} ${String(nz.length).padStart(4)} nonzero  ` +
      `dominant ${top[0][0]} ${share}%  ` +
      `[${top.slice(0, 5).map(([p, c]) => `${p}:${c}`).join(' ')}]`,
  );
}

console.log('\n=== PSDE columns by position ===');
const defFields = psde.f.map((f) => f.name).filter((f) => !['PGID', 'SEYR', 'sgmp'].includes(f));
for (const f of defFields) {
  const nz = psde.rows.filter((r) => n(r[f]) !== 0);
  if (!nz.length) continue;
  const byPos = new Map<string, number>();
  for (const r of nz) byPos.set(pos(n(r.PGID)), (byPos.get(pos(n(r.PGID))) ?? 0) + 1);
  const top = [...byPos].sort((a, b) => b[1] - a[1]);
  console.log(
    `  ${f.padEnd(5)} ${String(nz.length).padStart(4)} nonzero  ` +
      `[${top.slice(0, 5).map(([p, c]) => `${p}:${c}`).join(' ')}]`,
  );
}

// ------------------------------------------------------- 2. invariants
console.log('\n=== ARITHMETIC INVARIANTS (a <= b must hold on every row) ===');
const inv: Array<[string, string, string]> = [
  ['sacm', 'saat', 'completions <= attempts'],
  ['satd', 'sacm', 'passing TD <= completions'],
  ['sain', 'saat', 'interceptions <= attempts'],
  ['sasa', 'saat', 'sacks taken <= dropbacks'],
  ['salN', 'saya', 'longest pass <= passing yards'],
  ['sctd', 'scca', 'receiving TD <= catches'],
  ['scrL', 'scya', 'longest catch <= receiving yards'],
  ['sutd', 'suat', 'rushing TD <= carries'],
  ['sulN', 'suya', 'longest run <= rushing yards'],
  ['su2y', 'suat', '2-pt / conversions <= carries'],
];
for (const [a, b, label] of inv) {
  if (!offFields.includes(a) || !offFields.includes(b)) continue;
  const rel = psof.rows.filter((r) => n(r[a]) !== 0 || n(r[b]) !== 0);
  const ok = rel.filter((r) => n(r[a]) <= n(r[b])).length;
  console.log(
    `  ${ok === rel.length ? 'HOLDS ' : 'BREAKS'} ${a} <= ${b}  ` +
      `${ok}/${rel.length}  (${label})`,
  );
}

// A control: the same test on pairings we believe are WRONG. If nearly every
// pairing "holds", the invariant test is not discriminating and proves nothing.
console.log('\n  control -- invariants on deliberately wrong pairings:');
const control: Array<[string, string]> = [
  ['sacm', 'suat'],
  ['satd', 'scca'],
  ['salN', 'suya'],
  ['sctd', 'saat'],
];
for (const [a, b] of control) {
  const rel = psof.rows.filter((r) => n(r[a]) !== 0 || n(r[b]) !== 0);
  const ok = rel.filter((r) => n(r[a]) <= n(r[b])).length;
  console.log(`    ${ok === rel.length ? 'holds ' : 'breaks'} ${a} <= ${b}  ${ok}/${rel.length}`);
}

// ------------------------------------------------- 3. team aggregation
console.log('\n=== TEAM AGGREGATION (the discriminating test) ===');
// Only week 0 has been played, so a player's single stat line belongs to his
// team's single game. Group every PSOF row by team.
const byTeam = new Map<number, Array<Record<string, number | string>>>();
for (const r of psof.rows) {
  const t = playerTeam(n(r.PGID));
  if (!byTeam.has(t)) byTeam.set(t, []);
  byTeam.get(t)!.push(r);
}
const sum = (rs: Array<Record<string, number | string>>, f: string) =>
  rs.reduce((a, r) => a + n(r[f]), 0);

// Candidate identity: sum(receiving yards) == sum(passing yards) per team.
for (const [recvY, passY] of [
  ['scya', 'saya'],
  ['suya', 'saya'],
  ['scya', 'suya'],
] as const) {
  let ok = 0;
  let tot = 0;
  const bad: string[] = [];
  for (const [t, rs] of byTeam) {
    const a = sum(rs, recvY);
    const b = sum(rs, passY);
    if (a === 0 && b === 0) continue;
    tot++;
    if (a === b) ok++;
    else if (bad.length < 6) bad.push(`${tn.get(t)}: ${recvY}=${a} vs ${passY}=${b}`);
  }
  console.log(`  sum(${recvY}) == sum(${passY}) per team: ${ok}/${tot}`);
  for (const b of bad) console.log(`      ${b}`);
}

// Same for counts: catches == completions.
for (const [c, cm] of [
  ['scca', 'sacm'],
  ['scca', 'saat'],
] as const) {
  let ok = 0;
  let tot = 0;
  for (const [, rs] of byTeam) {
    const a = sum(rs, c);
    const b = sum(rs, cm);
    if (a === 0 && b === 0) continue;
    tot++;
    if (a === b) ok++;
  }
  console.log(`  sum(${c}) == sum(${cm}) per team: ${ok}/${tot}`);
}

// And TDs.
for (const [a, b] of [
  ['sctd', 'satd'],
] as const) {
  let ok = 0;
  let tot = 0;
  for (const [, rs] of byTeam) {
    const x = sum(rs, a);
    const y = sum(rs, b);
    if (x === 0 && y === 0) continue;
    tot++;
    if (x === y) ok++;
  }
  console.log(`  sum(${a}) == sum(${b}) per team: ${ok}/${tot}`);
}

// ----------------------------------------- 4. scoring reconciliation
console.log('\n=== SCORING: do TDs reconcile with the final score? ===');
const wk0 = schd.rows.filter((g) => n(g.SEWN) === 0 && !(n(g.GHSC) === 0 && n(g.GASC) === 0));
let recon = 0;
let checked = 0;
const misses: string[] = [];
for (const g of wk0) {
  for (const tg of [n(g.GHTG), n(g.GATG)]) {
    const rs = byTeam.get(tg);
    if (!rs) continue;
    const score = tg === n(g.GHTG) ? n(g.GHSC) : n(g.GASC);
    const tds = sum(rs, 'sutd') + sum(rs, 'sctd');
    checked++;
    // 6 points a touchdown; the remainder must be accountable by kicks and
    // defensive/special-teams scores, so demand only that TDs don't overshoot.
    if (tds * 6 <= score) recon++;
    else if (misses.length < 6) misses.push(`${tn.get(tg)}: ${tds} TD = ${tds * 6} pts but scored ${score}`);
  }
}
console.log(`  offensive TDs x6 never exceed the final score: ${recon}/${checked}`);
for (const m of misses) console.log(`      ${m}`);
