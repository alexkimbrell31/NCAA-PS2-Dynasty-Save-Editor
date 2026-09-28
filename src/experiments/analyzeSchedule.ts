/**
 * SCHD pass 1: work out what each of the 14 fields means.
 *
 * The shapes are suggestive (GTOD 660..1320 looks like minutes-of-day, GATG/GHTG
 * look like team ids with the familiar 511 sentinel) but suggestive is not
 * confirmed, so each hypothesis below is checked against TEAM/CONF or against
 * real 2006 scheduling facts.
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
  const f = parseFieldDescriptors(buf, h);
  return readRecords(buf, h, f);
}

const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

const schd = load('SCHD');
const team = load('TEAM');
const play = load('PLAY');

const teamByTgid = new Map(team.map((t) => [n(t.TGID), t]));
const fbs = new Set(play.map((p) => playerTeam(n(p.PGID))));

console.log(`SCHD: ${schd.length} games\n`);

// --- GTOD: minutes of day? -------------------------------------------------
const tods = [...new Set(schd.map((g) => n(g.GTOD)))].sort((a, b) => a - b);
console.log('GTOD distinct values, read as minutes-past-midnight:');
console.log(
  '  ' +
    tods
      .map((v) => {
        const hh = Math.floor(v / 60);
        const mm = v % 60;
        return `${v}=${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')}${hh < 12 ? 'am' : 'pm'}`;
      })
      .join('  '),
);
console.log(`  all multiples of 15? ${tods.every((v) => v % 15 === 0)}`);
const todCounts = new Map<number, number>();
for (const g of schd) todCounts.set(n(g.GTOD), (todCounts.get(n(g.GTOD)) ?? 0) + 1);
console.log(
  '  most common: ' +
    [...todCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([v, c]) => `${v}(${c})`)
      .join(' '),
);

// --- GATG / GHTG: team ids -------------------------------------------------
const away = schd.map((g) => n(g.GATG));
const home = schd.map((g) => n(g.GHTG));
const isTeam = (v: number) => teamByTgid.has(v);
console.log('\nGATG/GHTG as TEAM.TGID:');
console.log(
  `  GATG resolves ${away.filter(isTeam).length}/${away.length}, ` +
    `${away.filter((v) => v === NO_TEAM).length} are the 511 sentinel`,
);
console.log(
  `  GHTG resolves ${home.filter(isTeam).length}/${home.length}, ` +
    `${home.filter((v) => v === NO_TEAM).length} are the 511 sentinel`,
);
console.log(
  `  GHTG distinct=${new Set(home).size}  GATG distinct=${new Set(away).size} ` +
    `(FBS teams = ${fbs.size})`,
);
console.log(`  any team playing itself? ${schd.some((g) => n(g.GATG) === n(g.GHTG))}`);

// --- GSTA: game status -----------------------------------------------------
const staCounts = new Map<number, number>();
for (const g of schd) staCounts.set(n(g.GSTA), (staCounts.get(n(g.GSTA)) ?? 0) + 1);
console.log('\nGSTA counts: ' + [...staCounts.entries()].sort().map(([v, c]) => `${v}:${c}`).join(' '));
for (const [s] of [...staCounts.entries()].sort()) {
  const rows = schd.filter((g) => n(g.GSTA) === s);
  const scored = rows.filter((g) => n(g.GASC) > 0 || n(g.GHSC) > 0).length;
  console.log(`  GSTA=${s}: ${rows.length} games, ${scored} have a non-zero score`);
}

// --- GASC / GHSC: scores ---------------------------------------------------
const played = schd.filter((g) => n(g.GASC) > 0 || n(g.GHSC) > 0);
console.log(`\n${played.length} games carry a score.`);
const impossible = played.filter((g) => [1, 2, 3, 4, 5, 7].includes(0)); // placeholder
const bad = played.filter((g) => {
  const a = n(g.GASC);
  const h = n(g.GHSC);
  return a === 1 || h === 1; // a score of 1 is impossible in football
});
console.log(`  scores of exactly 1 (impossible in football): ${bad.length}`);
console.log(`  ties: ${played.filter((g) => n(g.GASC) === n(g.GHSC)).length} (OT means ties are rare)`);
const homeWins = played.filter((g) => n(g.GHSC) > n(g.GASC)).length;
console.log(
  `  home team won ${homeWins}/${played.length} = ${((homeWins / played.length) * 100).toFixed(1)}% ` +
    `(real CFB home win rate is ~60%)`,
);
console.log('  sample results:');
for (const g of played.slice(0, 12)) {
  const a = teamByTgid.get(n(g.GATG));
  const h = teamByTgid.get(n(g.GHTG));
  console.log(
    `    wk${String(n(g.SEWN)).padStart(2)} ${(a ? teamName(a) : `?${n(g.GATG)}`).padEnd(26)} ` +
      `${String(n(g.GASC)).padStart(2)} @ ${String(n(g.GHSC)).padStart(2)} ${h ? teamName(h) : `?${n(g.GHTG)}`}`,
  );
}

// --- GDAT / SEWN / SEWT / SGNM: calendar -----------------------------------
console.log('\nGDAT (0-6) counts: ');
const datCounts = new Map<number, number>();
for (const g of schd) datCounts.set(n(g.GDAT), (datCounts.get(n(g.GDAT)) ?? 0) + 1);
const DOW = ['?0', '?1', '?2', '?3', '?4', '?5', '?6'];
console.log(
  '  ' + [...datCounts.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v}:${c}`).join(' '),
);

console.log('\nSEWN (week number) counts:');
const wkCounts = new Map<number, number>();
for (const g of schd) wkCounts.set(n(g.SEWN), (wkCounts.get(n(g.SEWN)) ?? 0) + 1);
console.log(
  '  ' + [...wkCounts.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v}:${c}`).join(' '),
);

console.log('\nSEWT counts:');
const ewtCounts = new Map<number, number>();
for (const g of schd) ewtCounts.set(n(g.SEWT), (ewtCounts.get(n(g.SEWT)) ?? 0) + 1);
console.log(
  '  ' + [...ewtCounts.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v}:${c}`).join(' '),
);

console.log(`\nSGNM: min ${Math.min(...schd.map((g) => n(g.SGNM)))} max ${Math.max(...schd.map((g) => n(g.SGNM)))}`);
// Is SGNM unique within a week?
let dupInWeek = 0;
const byWeek = new Map<number, typeof schd>();
for (const g of schd) {
  const k = n(g.SEWN) * 100 + n(g.SEWT);
  if (!byWeek.has(k)) byWeek.set(k, []);
  byWeek.get(k)!.push(g);
}
for (const [, gs] of byWeek) {
  if (new Set(gs.map((g) => n(g.SGNM))).size !== gs.length) dupInWeek++;
}
console.log(`  weeks (SEWN+SEWT) where SGNM is NOT unique: ${dupInWeek} of ${byWeek.size}`);

// --- flags -----------------------------------------------------------------
for (const f of ['GFOT', 'GFFU', 'GFHU', 'GMFX']) {
  const on = schd.filter((g) => n(g[f]) === 1);
  console.log(`\n${f}: ${on.length} games set`);
  if (on.length && on.length < 40) {
    for (const g of on.slice(0, 8)) {
      const a = teamByTgid.get(n(g.GATG));
      const h = teamByTgid.get(n(g.GHTG));
      console.log(
        `    wk${n(g.SEWN)} ${(a ? teamName(a) : '?').padEnd(26)} @ ${h ? teamName(h) : '?'} ` +
          `score ${n(g.GASC)}-${n(g.GHSC)} GSTA=${n(g.GSTA)}`,
      );
    }
  }
}
