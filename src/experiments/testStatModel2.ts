/**
 * Follow-ups from testStatModel.ts:
 *   a) sulN > suya on 110 rows. Decoding error, or legitimate?
 *   b) scyc reaches 8191 = all-ones in 13 bits. Sentinel?
 *   c) suyh and subt have identical nonzero counts AND position profiles.
 *   d) which of PSOF/PSDE columns are still unexplained?
 */

import {
  PLAYER_POSITIONS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
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
const team = load('TEAM');
const byP = new Map(play.rows.map((p) => [n(p.PGID), p]));
const tn = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));
const who = (pgid: number) => {
  const p = byP.get(pgid)!;
  const nm = playerName(p);
  return `${nm.first} ${nm.last} (${PLAYER_POSITIONS[n(p.PPOS)]}, ${tn.get(playerTeam(pgid))})`;
};

// (a) longest run exceeding total rushing yards
console.log('=== (a) sulN > suya ===');
const over = psof.rows.filter((r) => n(r.sulN) > n(r.suya));
console.log(`${over.length} rows. Is it explained by carries that LOST yards?`);
const multi = over.filter((r) => n(r.suat) > 1).length;
const single = over.filter((r) => n(r.suat) === 1).length;
console.log(`  ${multi} have more than one carry (so a loss elsewhere can explain it)`);
console.log(`  ${single} have exactly ONE carry (cannot be explained -- would be a real problem)`);
const neg = psof.rows.filter((r) => n(r.suya) < 0).length;
console.log(`  ${neg} rows have NEGATIVE total rushing yards (field is signed)`);
console.log('  worst examples:');
for (const r of [...over].sort((a, b) => n(b.sulN) - n(b.suya) - (n(a.sulN) - n(a.suya))).slice(0, 5)) {
  console.log(
    `    ${who(n(r.PGID)).padEnd(46)} carries ${String(n(r.suat)).padStart(3)} ` +
      `yards ${String(n(r.suya)).padStart(4)} long ${String(n(r.sulN)).padStart(3)}`,
  );
}

console.log('\n=== (a2) same question for scrL > scya ===');
const cover = psof.rows.filter((r) => n(r.scrL) > n(r.scya));
console.log(
  `${cover.length} rows; ${cover.filter((r) => n(r.scca) > 1).length} have >1 catch, ` +
    `${cover.filter((r) => n(r.scca) === 1).length} have exactly one`,
);
for (const r of cover.slice(0, 5)) {
  console.log(
    `    ${who(n(r.PGID)).padEnd(46)} catches ${String(n(r.scca)).padStart(2)} ` +
      `yards ${String(n(r.scya)).padStart(4)} long ${String(n(r.scrL)).padStart(3)}`,
  );
}

console.log('\n=== (a3) sasa > saat ===');
for (const r of psof.rows.filter((r) => n(r.sasa) > n(r.saat))) {
  console.log(
    `    ${who(n(r.PGID)).padEnd(46)} att ${n(r.saat)} sacks ${n(r.sasa)} ` +
      `yards ${n(r.saya)} comp ${n(r.sacm)}`,
  );
}

// (b) scyc sentinel
console.log('\n=== (b) scyc ===');
const vals = psof.rows.map((r) => n(r.scyc));
const maxed = vals.filter((v) => v === 8191).length;
console.log(`13 bits; ${maxed} rows sit at all-ones 8191; ${vals.filter((v) => v === 0).length} are zero`);
console.log(`distribution of the rest: ${[...new Set(vals.filter((v) => v !== 0 && v !== 8191))].sort((a, b) => a - b).slice(0, 20).join(', ')} ...`);
// Is scyc related to scya?
const rel = psof.rows.filter((r) => n(r.scyc) !== 0 && n(r.scyc) !== 8191);
const le = rel.filter((r) => n(r.scyc) <= n(r.scya)).length;
console.log(`scyc <= scya on ${le}/${rel.length} of non-sentinel rows`);
const eq = psof.rows.filter((r) => n(r.scyc) === n(r.scya)).length;
console.log(`scyc == scya on ${eq}/${psof.rows.length}`);
// yards after catch would be <= receiving yards
console.log('  sample (catches, recvYds, scyc):');
for (const r of rel.slice(0, 8)) {
  console.log(
    `    ${who(n(r.PGID)).padEnd(46)} ${String(n(r.scca)).padStart(2)} ` +
      `${String(n(r.scya)).padStart(4)} ${String(n(r.scyc)).padStart(5)}`,
  );
}

// (c) suyh vs subt
console.log('\n=== (c) suyh vs subt ===');
const bothNz = psof.rows.filter((r) => n(r.suyh) !== 0 || n(r.subt) !== 0);
const same = bothNz.filter((r) => n(r.suyh) === n(r.subt)).length;
const coNz = psof.rows.filter((r) => (n(r.suyh) !== 0) === (n(r.subt) !== 0)).length;
console.log(
  `identical value on ${same}/${bothNz.length}; co-occur (both zero or both nonzero) on ${coNz}/${psof.rows.length}`,
);
console.log(`  suyh <= subt on ${bothNz.filter((r) => n(r.suyh) <= n(r.subt)).length}/${bothNz.length}`);
console.log(`  subt <= suyh on ${bothNz.filter((r) => n(r.subt) <= n(r.suyh)).length}/${bothNz.length}`);
for (const r of bothNz.slice(0, 8)) {
  console.log(
    `    ${who(n(r.PGID)).padEnd(46)} carries ${String(n(r.suat)).padStart(3)} ` +
      `yds ${String(n(r.suya)).padStart(4)} subt ${String(n(r.subt)).padStart(3)} suyh ${String(n(r.suyh)).padStart(3)}`,
  );
}

// (d) PSDE aggregation tests
console.log('\n=== (d) PSDE cross-checks ===');
const byTeamD = new Map<number, Array<Record<string, number | string>>>();
for (const r of psde.rows) {
  const t = playerTeam(n(r.PGID));
  if (!byTeamD.has(t)) byTeamD.set(t, []);
  byTeamD.get(t)!.push(r);
}
const byTeamO = new Map<number, Array<Record<string, number | string>>>();
for (const r of psof.rows) {
  const t = playerTeam(n(r.PGID));
  if (!byTeamO.has(t)) byTeamO.set(t, []);
  byTeamO.get(t)!.push(r);
}
const sum = (rs: Array<Record<string, number | string>> | undefined, f: string) =>
  (rs ?? []).reduce((a, r) => a + n(r[f]), 0);

// A defense's interceptions should equal the OPPOSING offense's interceptions
// thrown. Needs the opponent, which SCHD gives us.
const schd = load('SCHD');
let intOk = 0;
let intTot = 0;
const intBad: string[] = [];
for (const g of schd.rows) {
  if (n(g.SEWN) !== 0 || (n(g.GHSC) === 0 && n(g.GASC) === 0)) continue;
  for (const [d, o] of [
    [n(g.GHTG), n(g.GATG)],
    [n(g.GATG), n(g.GHTG)],
  ]) {
    const picks = sum(byTeamD.get(d), 'ssin');
    const thrown = sum(byTeamO.get(o), 'sain');
    intTot++;
    if (picks === thrown) intOk++;
    else if (intBad.length < 6)
      intBad.push(`${tn.get(d)} D had ${picks} INT, ${tn.get(o)} O threw ${thrown}`);
  }
}
console.log(`defense INTs == opponent's INTs thrown: ${intOk}/${intTot}`);
for (const b of intBad) console.log(`    ${b}`);

let sackOk = 0;
let sackTot = 0;
const sackBad: string[] = [];
for (const g of schd.rows) {
  if (n(g.SEWN) !== 0 || (n(g.GHSC) === 0 && n(g.GASC) === 0)) continue;
  for (const [d, o] of [
    [n(g.GHTG), n(g.GATG)],
    [n(g.GATG), n(g.GHTG)],
  ]) {
    const made = sum(byTeamD.get(d), 'slsk');
    const taken = sum(byTeamO.get(o), 'sasa');
    sackTot++;
    if (made === taken) sackOk++;
    else if (sackBad.length < 6)
      sackBad.push(`${tn.get(d)} D made ${made} sacks, ${tn.get(o)} QBs took ${taken}`);
  }
}
console.log(`defense sacks == opponent's sacks taken: ${sackOk}/${sackTot}`);
for (const b of sackBad) console.log(`    ${b}`);

// ssiy should be <= ... and only nonzero when ssin is
const iy = psde.rows.filter((r) => n(r.ssiy) !== 0);
console.log(
  `\nssiy nonzero on ${iy.length} rows; of those ${iy.filter((r) => n(r.ssin) !== 0).length} also have ssin != 0`,
);
const dt = psde.rows.filter((r) => n(r.ssdt) !== 0);
console.log(
  `ssdt nonzero on ${dt.length}; of those ${dt.filter((r) => n(r.ssin) !== 0 || n(r.slfr) !== 0).length} also have an INT or a fumble recovery`,
);
const fy = psde.rows.filter((r) => n(r.slfy) !== 0);
console.log(
  `slfy nonzero on ${fy.length}; of those ${fy.filter((r) => n(r.slfr) !== 0).length} also have slfr != 0`,
);
const tl = psde.rows.filter((r) => n(r.sdtl) !== 0);
console.log(`sdtl <= sdta on ${tl.filter((r) => n(r.sdtl) <= n(r.sdta)).length}/${tl.length}`);
const sk = psde.rows.filter((r) => n(r.slsk) !== 0);
console.log(`slsk <= sdtl on ${sk.filter((r) => n(r.slsk) <= n(r.sdtl)).length}/${sk.length}`);
