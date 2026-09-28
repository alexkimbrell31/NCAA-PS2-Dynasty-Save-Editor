/**
 * The defense-vs-offense cross-checks failed on 36/136 and 48/136. Hypothesis:
 * every failure involves an FCS opponent, which has no PLAY roster and
 * therefore no stat rows at all -- so the "missing" side was never stored.
 *
 * If true, restricting to FBS-vs-FBS games should make both identities exact.
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
const tn = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));
const fbs = new Set(play.rows.map((p) => playerTeam(n(p.PGID))));

const group = (rows: Array<Record<string, number | string>>) => {
  const m = new Map<number, Array<Record<string, number | string>>>();
  for (const r of rows) {
    const t = playerTeam(n(r.PGID));
    if (!m.has(t)) m.set(t, []);
    m.get(t)!.push(r);
  }
  return m;
};
const off = group(psof.rows);
const def = group(psde.rows);
const sum = (rs: Array<Record<string, number | string>> | undefined, f: string) =>
  (rs ?? []).reduce((a, r) => a + n(r[f]), 0);

const games = schd.rows.filter(
  (g) => n(g.SEWN) === 0 && !(n(g.GHSC) === 0 && n(g.GASC) === 0),
);
console.log(`${games.length} played week-0 games`);
const fbsOnly = games.filter((g) => fbs.has(n(g.GHTG)) && fbs.has(n(g.GATG)));
console.log(`${fbsOnly.length} are FBS vs FBS; ${games.length - fbsOnly.length} involve an FCS team`);

for (const [label, dField, oField] of [
  ['interceptions', 'ssin', 'sain'],
  ['sacks', 'slsk', 'sasa'],
  ['fumble recoveries vs fumbles', 'slfr', 'sufu'],
] as const) {
  for (const [scope, set] of [
    ['all games', games],
    ['FBS vs FBS only', fbsOnly],
  ] as const) {
    let ok = 0;
    let tot = 0;
    const bad: string[] = [];
    for (const g of set) {
      for (const [d, o] of [
        [n(g.GHTG), n(g.GATG)],
        [n(g.GATG), n(g.GHTG)],
      ]) {
        const a = sum(def.get(d), dField);
        const b = sum(off.get(o), oField);
        tot++;
        if (a === b) ok++;
        else if (bad.length < 4) bad.push(`${tn.get(d)} ${a} vs ${tn.get(o)} ${b}`);
      }
    }
    console.log(`  ${label.padEnd(30)} ${scope.padEnd(16)} ${ok}/${tot}`);
    if (scope === 'FBS vs FBS only') for (const b of bad) console.log(`        ${b}`);
  }
}

// Do FCS teams have ANY stat rows?
const fcsTeams = new Set<number>();
for (const g of games) {
  if (!fbs.has(n(g.GHTG))) fcsTeams.add(n(g.GHTG));
  if (!fbs.has(n(g.GATG))) fcsTeams.add(n(g.GATG));
}
const fcsWithStats = [...fcsTeams].filter((t) => off.has(t) || def.has(t));
console.log(
  `\n${fcsTeams.size} FCS teams played in week 0; ${fcsWithStats.length} of them have any stat row`,
);

// Confirm every PSOF/PSDE row belongs to an FBS team.
console.log(
  `PSOF rows on an FBS team: ${psof.rows.filter((r) => fbs.has(playerTeam(n(r.PGID)))).length}/${psof.rows.length}`,
);
console.log(
  `PSDE rows on an FBS team: ${psde.rows.filter((r) => fbs.has(playerTeam(n(r.PGID)))).length}/${psde.rows.length}`,
);

// Team-level totals: do TSPF/TSPA match the score?
const tspf = team.rows.filter((t) => {
  const g = games.find((x) => n(x.GHTG) === n(t.TGID) || n(x.GATG) === n(t.TGID));
  if (!g) return false;
  const score = n(g.GHTG) === n(t.TGID) ? n(g.GHSC) : n(g.GASC);
  return n(t.TSPF) === score;
});
console.log(`\nTEAM.TSPF == the team's week-0 points scored: ${tspf.length}/${
  team.rows.filter((t) => games.some((x) => n(x.GHTG) === n(t.TGID) || n(x.GATG) === n(t.TGID))).length
}`);
const tspa = team.rows.filter((t) => {
  const g = games.find((x) => n(x.GHTG) === n(t.TGID) || n(x.GATG) === n(t.TGID));
  if (!g) return false;
  const opp = n(g.GHTG) === n(t.TGID) ? n(g.GASC) : n(g.GHSC);
  return n(t.TSPA) === opp;
});
console.log(`TEAM.TSPA == the team's week-0 points allowed: ${tspa.length}/${
  team.rows.filter((t) => games.some((x) => n(x.GHTG) === n(t.TGID) || n(x.GATG) === n(t.TGID))).length
}`);
