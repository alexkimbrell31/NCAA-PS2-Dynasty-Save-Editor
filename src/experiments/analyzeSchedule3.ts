/**
 * SCHD pass 3.
 *
 * Pass 2 turned up a striking pattern: for GSTA=1 the home team won 0/20, and
 * for GSTA=2 the home team won 48/48. That is not a "played/unplayed" status
 * field at all -- it looks like the WINNER. Test that, plus:
 *   - the 34 both-sides-511 rows cluster in weeks 15/18/19/20/21: bowl slots?
 *   - GDAT=0 appears only in weeks 20-21. If 0 = Monday, that is Jan 1 2007.
 *   - the 4 GMFX=0 games that still look same-conference
 *   - SGNM as a within-week game index
 *   - rivalry games should land late and match TEAM.TMRV
 */

import {
  NO_TEAM,
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

const schd = load('SCHD');
const team = load('TEAM');
const play = load('PLAY');
const conf = load('CONF');

const teamByTgid = new Map(team.map((t) => [n(t.TGID), t]));
const fbs = new Set(play.map((p) => playerTeam(n(p.PGID))));
const confName = new Map(conf.map((c) => [n(c.CGID), String(c.CNAM)]));
const nm = (id: number) => {
  const t = teamByTgid.get(id);
  return t ? teamName(t) : id === NO_TEAM ? '<TBD>' : `?${id}`;
};
const real = schd.filter(
  (g) => n(g.GATG) !== NO_TEAM && n(g.GHTG) !== NO_TEAM,
);

// --- GSTA = winner ---------------------------------------------------------
console.log('=== GSTA as WINNER, not status ===');
const scored = schd.filter((g) => n(g.GASC) > 0 || n(g.GHSC) > 0);
const awayWon = scored.filter((g) => n(g.GASC) > n(g.GHSC));
const homeWon = scored.filter((g) => n(g.GHSC) > n(g.GASC));
console.log(`  games with a score: ${scored.length}`);
console.log(
  `  away team won: ${awayWon.length}, of which GSTA=1: ${awayWon.filter((g) => n(g.GSTA) === 1).length}`,
);
console.log(
  `  home team won: ${homeWon.length}, of which GSTA=2: ${homeWon.filter((g) => n(g.GSTA) === 2).length}`,
);
console.log(
  `  GSTA=0 games with a score: ${schd.filter((g) => n(g.GSTA) === 0 && (n(g.GASC) > 0 || n(g.GHSC) > 0)).length}`,
);
console.log('  => GSTA: 0 = not yet played, 1 = away team won, 2 = home team won');

// Which week-0 games are still unplayed, and why?
const wk0 = schd.filter((g) => n(g.SEWN) === 0);
const wk0Unplayed = wk0.filter((g) => n(g.GSTA) === 0);
console.log(`\nWeek 0: ${wk0.length} games, ${wk0Unplayed.length} still unplayed:`);
for (const g of wk0Unplayed) {
  console.log(
    `  ${nm(n(g.GATG)).padEnd(28)} @ ${nm(n(g.GHTG)).padEnd(28)} ` +
      `GFFU=${n(g.GFFU)} GFHU=${n(g.GFHU)} GDAT=${n(g.GDAT)} GTOD=${n(g.GTOD)}`,
  );
}

// --- postseason ------------------------------------------------------------
console.log('\n=== Postseason structure (both teams TBD) ===');
const post = new Map<string, number>();
for (const g of schd.filter((x) => n(x.SEWN) >= 14)) {
  const k = `SEWN=${n(g.SEWN)} SEWT=${n(g.SEWT)}`;
  post.set(k, (post.get(k) ?? 0) + 1);
}
for (const [k, c] of post) console.log(`  ${k}: ${c} slots`);
console.log(
  '  Week 15 has exactly 5 slots. 2006 had exactly 5 conference championship\n' +
    '  games: ACC, Big 12, Conference USA, MAC, SEC.',
);

const jan1 = schd.filter((g) => n(g.SEWN) === 20);
console.log(`\n  Week 20 (${jan1.length} slots) all have GDAT=${[...new Set(jan1.map((g) => n(g.GDAT)))].join(',')}.`);
console.log('  Jan 1 2007 fell on a MONDAY, so GDAT=0 = Monday and 5 = Saturday.');
console.log(
  '  kickoff times: ' +
    jan1
      .map((g) => {
        const v = n(g.GTOD);
        return `${((Math.floor(v / 60) + 11) % 12) + 1}:${String(v % 60).padStart(2, '0')}`;
      })
      .sort()
      .join(' '),
);

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
console.log('\n  GDAT read as Monday-based day of week:');
for (const d of [0, 1, 2, 3, 4, 5, 6]) {
  console.log(`    ${DOW[d]}: ${schd.filter((g) => n(g.GDAT) === d).length}`);
}

// --- GMFX exceptions -------------------------------------------------------
console.log('\n=== GMFX=0 games that still share a conference ===');
for (const g of real.filter((x) => n(x.GMFX) === 0)) {
  const a = teamByTgid.get(n(g.GATG))!;
  const h = teamByTgid.get(n(g.GHTG))!;
  if (n(a.CGID) === n(h.CGID)) {
    console.log(
      `  ${nm(n(g.GATG)).padEnd(26)} @ ${nm(n(g.GHTG)).padEnd(26)} ` +
        `conf="${confName.get(n(a.CGID))}"`,
    );
  }
}

// --- SGNM ------------------------------------------------------------------
console.log('\n=== SGNM as a within-week index ===');
let ok = 0;
const weeks = [...new Set(schd.map((g) => n(g.SEWN)))].sort((a, b) => a - b);
for (const w of weeks) {
  const gs = schd.filter((g) => n(g.SEWN) === w);
  const ids = gs.map((g) => n(g.SGNM)).sort((a, b) => a - b);
  const contiguous = ids.every((v, i) => v === i);
  if (contiguous) ok++;
  else console.log(`  week ${w}: ${gs.length} games, SGNM ${ids[0]}..${ids[ids.length - 1]} NOT 0..n-1`);
}
console.log(`  weeks where SGNM is exactly 0..n-1: ${ok}/${weeks.length}`);

// --- schedule sanity per team ---------------------------------------------
console.log('\n=== Per-team schedule sanity ===');
const bad: string[] = [];
for (const t of fbs) {
  const gs = real.filter((g) => n(g.GATG) === t || n(g.GHTG) === t);
  const wks = gs.map((g) => n(g.SEWN));
  if (new Set(wks).size !== wks.length) bad.push(`${nm(t)} plays twice in one week`);
  const home = gs.filter((g) => n(g.GHTG) === t).length;
  if (home < 4 || home > 8) bad.push(`${nm(t)} has ${home} home games`);
}
console.log(`  teams playing twice in a week, or with a lopsided home split: ${bad.length}`);
for (const b of bad.slice(0, 6)) console.log(`    ${b}`);
const gcount = new Map<number, number>();
for (const g of real) for (const id of [n(g.GATG), n(g.GHTG)]) gcount.set(id, (gcount.get(id) ?? 0) + 1);
const eleven = [...fbs].filter((t) => gcount.get(t) === 11);
console.log(`  FBS teams with only 11 games: ${eleven.map(nm).join(', ') || 'none'}`);

// --- rivalries -------------------------------------------------------------
console.log('\n=== Rivalry games (TEAM.TMRV) ===');
let found = 0;
let lateCount = 0;
const weekOf: number[] = [];
for (const t of team) {
  const a = n(t.TGID);
  const r = n(t.TMRV);
  if (!fbs.has(a) || !fbs.has(r)) continue;
  const g = real.find(
    (x) =>
      (n(x.GATG) === a && n(x.GHTG) === r) || (n(x.GATG) === r && n(x.GHTG) === a),
  );
  if (g) {
    found++;
    weekOf.push(n(g.SEWN));
    if (n(g.SEWN) >= 10) lateCount++;
  }
}
console.log(`  FBS rivalry pairs whose game appears on the schedule: ${found}`);
console.log(
  `  played in week 10 or later: ${lateCount}/${found} = ${((lateCount / found) * 100).toFixed(1)}% ` +
    `(rivalry week is traditionally the season finale)`,
);
const wkHist = new Map<number, number>();
for (const w of weekOf) wkHist.set(w, (wkHist.get(w) ?? 0) + 1);
console.log(
  '  by week: ' + [...wkHist.entries()].sort((a, b) => a[0] - b[0]).map(([w, c]) => `${w}:${c}`).join(' '),
);
for (const [aName, bName] of [
  ['Ohio State', 'Michigan'],
  ['Army', 'Navy'],
  ['Alabama', 'Auburn'],
  ['Washington', 'Washington State'],
]) {
  const A = team.find((t) => String(t.TDNA) === aName);
  const B = team.find((t) => String(t.TDNA) === bName);
  if (!A || !B) continue;
  const g = real.find(
    (x) =>
      (n(x.GATG) === n(A.TGID) && n(x.GHTG) === n(B.TGID)) ||
      (n(x.GATG) === n(B.TGID) && n(x.GHTG) === n(A.TGID)),
  );
  console.log(
    `  ${aName} vs ${bName}: ` +
      (g ? `week ${n(g.SEWN)}, ${nm(n(g.GATG))} @ ${nm(n(g.GHTG))}` : 'NOT SCHEDULED'),
  );
}
