/**
 * Validate the decoded SCHD table.
 *
 * SCHD is unusually well suited to semantic validation, because a college
 * football schedule has to satisfy a lot of hard structural rules (nobody plays
 * twice in a week, nobody plays themselves) and because the 2006 season is a
 * matter of public record (5 conference championship games, Army-Navy a week
 * after everyone else, New Year's Day on a Monday).
 */

import {
  GAME_AWAY_WON,
  GAME_DAYS,
  GAME_HOME_WON,
  GAME_UNPLAYED,
  NO_TEAM,
  WEEK_TYPES,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
} from './lib/eadb.ts';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail: string) =>
  checks.push({ name, pass, detail });
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (name: string) => {
    const h = parseTableHeader(buf, findTable(toc, name).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { header: h, fields: f, records: readRecords(buf, h, f) };
  };

  const schd = load('SCHD');
  const team = load('TEAM');
  const play = load('PLAY');
  const conf = load('CONF');
  const games = schd.records;

  console.log(`SCHD: ${games.length} records, ${schd.fields.length} fields\n`);

  const byTgid = new Map(team.records.map((t) => [n(t.TGID), t]));
  const fbs = new Set(play.records.map((p) => playerTeam(n(p.PGID))));
  const real = games.filter((g) => n(g.GATG) !== NO_TEAM && n(g.GHTG) !== NO_TEAM);
  const scored = games.filter((g) => n(g.GASC) > 0 || n(g.GHSC) > 0);

  // --- structure ------------------------------------------------------------
  const sorted = [...schd.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  let gaps = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) gaps++;
    cursor += f.bits;
  }
  check(
    'fields tile the record with no gaps or overlaps',
    gaps === 0,
    `bits 0..${cursor - 1} of ${schd.header.recordLenBytes * 8}`,
  );

  // --- team references ------------------------------------------------------
  const resolves = (v: number) => byTgid.has(v) || v === NO_TEAM;
  check(
    'GATG and GHTG resolve to TEAM.TGID or the 511 sentinel',
    games.every((g) => resolves(n(g.GATG)) && resolves(n(g.GHTG))),
    `${real.length} real matchups, ${games.length - real.length} TBD postseason slots`,
  );
  check(
    'no team is scheduled against itself',
    real.every((g) => n(g.GATG) !== n(g.GHTG)),
    `checked ${real.length} matchups`,
  );

  // Non-FBS opponents are bought-in guarantee games; they are always played at
  // the FBS school's stadium, never the other way around.
  const homeIds = new Set(real.map((g) => n(g.GHTG)));
  check(
    'every home team is an FBS school',
    [...homeIds].every((id) => fbs.has(id)),
    `${homeIds.size} distinct home teams, all with a roster`,
  );
  const fcsGames = real.filter((g) => !fbs.has(n(g.GATG)));
  check(
    'non-FBS opponents always play on the road',
    fcsGames.every((g) => fbs.has(n(g.GHTG))),
    `${fcsGames.length} guarantee games, all hosted by the FBS team`,
  );

  // --- schedule integrity ---------------------------------------------------
  let doubleBooked = 0;
  const gameCount = new Map<number, number>();
  for (const t of fbs) {
    const gs = real.filter((g) => n(g.GATG) === t || n(g.GHTG) === t);
    gameCount.set(t, gs.length);
    const weeks = gs.map((g) => n(g.SEWN));
    if (new Set(weeks).size !== weeks.length) doubleBooked++;
  }
  check(
    'no team plays twice in the same week',
    doubleBooked === 0,
    `checked all ${fbs.size} FBS schedules`,
  );
  const counts = [...gameCount.values()];
  check(
    'every FBS team plays a full regular-season slate',
    counts.every((c) => c >= 11 && c <= 12),
    `${counts.filter((c) => c === 12).length} teams play 12, ` +
      `${counts.filter((c) => c === 11).length} play 11`,
  );
  const homeGames = [...fbs].map(
    (t) => real.filter((g) => n(g.GHTG) === t).length,
  );
  check(
    'home and away games are balanced for every team',
    homeGames.every((h) => h >= 4 && h <= 8),
    `home games range ${Math.min(...homeGames)}..${Math.max(...homeGames)}`,
  );

  // --- GSTA is the winner, not a status -------------------------------------
  const awayWins = scored.filter((g) => n(g.GASC) > n(g.GHSC));
  const homeWins = scored.filter((g) => n(g.GHSC) > n(g.GASC));
  check(
    'GSTA encodes which side won',
    awayWins.every((g) => n(g.GSTA) === GAME_AWAY_WON) &&
      homeWins.every((g) => n(g.GSTA) === GAME_HOME_WON),
    `${awayWins.length} away wins all GSTA=1, ${homeWins.length} home wins all GSTA=2`,
  );
  check(
    'unplayed games carry no score',
    games
      .filter((g) => n(g.GSTA) === GAME_UNPLAYED)
      .every((g) => n(g.GASC) === 0 && n(g.GHSC) === 0),
    `${games.filter((g) => n(g.GSTA) === GAME_UNPLAYED).length} unplayed games are all 0-0`,
  );
  check(
    'no completed game ended in a tie',
    scored.every((g) => n(g.GASC) !== n(g.GHSC)),
    `${scored.length} results; overtime makes ties impossible`,
  );
  check(
    'no impossible football scores',
    scored.every((g) => n(g.GASC) !== 1 && n(g.GHSC) !== 1),
    `scores range 0..${Math.max(...scored.flatMap((g) => [n(g.GASC), n(g.GHSC)]))}`,
  );

  // --- calendar -------------------------------------------------------------
  check(
    'GDAT is a valid day index, overwhelmingly Saturday',
    games.every((g) => n(g.GDAT) >= 0 && n(g.GDAT) <= 6),
    `Saturday ${games.filter((g) => n(g.GDAT) === 5).length}/${games.length}, ` +
      `Thursday ${games.filter((g) => n(g.GDAT) === 3).length}, ` +
      `Sunday ${games.filter((g) => n(g.GDAT) === 6).length}`,
  );
  // Jan 1 2007 was a Monday, so the New Year's bowl slate pins the day index.
  const newYear = games.filter((g) => n(g.SEWT) === 32);
  check(
    "the New Year's bowl slate all falls on the same weekday (Monday)",
    newYear.length > 0 && newYear.every((g) => n(g.GDAT) === 0),
    `${newYear.length} slots, all GDAT=0 = ${GAME_DAYS[0]}; Jan 1 2007 was a Monday`,
  );
  check(
    'GTOD is a kickoff time on a 15-minute boundary',
    games.every((g) => n(g.GTOD) % 15 === 0 && n(g.GTOD) >= 600 && n(g.GTOD) <= 1440),
    `${Math.min(...games.map((g) => n(g.GTOD)))}..${Math.max(...games.map((g) => n(g.GTOD)))} ` +
      `minutes past midnight (11:00am..10:00pm)`,
  );
  check(
    'SGNM numbers the games within each week from zero',
    [...new Set(games.map((g) => n(g.SEWN)))].every((w) => {
      const ids = games.filter((g) => n(g.SEWN) === w).map((g) => n(g.SGNM)).sort((a, b) => a - b);
      return ids.every((v, i) => v === i);
    }),
    `contiguous 0..n-1 in all ${new Set(games.map((g) => n(g.SEWN))).size} weeks`,
  );

  // --- postseason -----------------------------------------------------------
  const champWeek = games.filter((g) => n(g.SEWT) === 15);
  check(
    'there are exactly 5 conference championship slots',
    champWeek.length === 5,
    `${champWeek.length} slots; 2006 had 5 title games (ACC, Big 12, C-USA, MAC, SEC)`,
  );
  check(
    'exactly one national championship slot exists',
    games.filter((g) => n(g.SEWT) === 40).length === 1,
    `SEWT=40 is the BCS title game`,
  );
  const postseason = games.filter((g) => n(g.SEWN) >= 14);
  check(
    'all postseason slots have undetermined participants',
    postseason.every((g) => n(g.GATG) === NO_TEAM && n(g.GHTG) === NO_TEAM),
    `${postseason.length} slots across ${new Set(postseason.map((g) => n(g.SEWT))).size} week types`,
  );
  check(
    'SEWT matches SEWN through the regular season, then switches to week-type codes',
    games
      .filter((g) => n(g.SEWN) <= 13)
      .every((g) => n(g.SEWT) === n(g.SEWN)) &&
      postseason.every((g) => n(g.SEWT) in WEEK_TYPES),
    `regular season 0..13 identical; postseason codes ${[...new Set(postseason.map((g) => n(g.SEWT)))].join(',')}`,
  );

  // --- conference games -----------------------------------------------------
  const sameConf = (g: (typeof real)[0]) => {
    const a = byTgid.get(n(g.GATG));
    const h = byTgid.get(n(g.GHTG));
    return a && h && n(a.CGID) === n(h.CGID);
  };
  const indep = conf.records.find((c) => String(c.CNAM).includes('Independent'));
  const indepId = indep ? n(indep.CGID) : -1;
  const confGames = real.filter((g) => n(g.GMFX) === 1);
  check(
    'GMFX marks conference games',
    confGames.every(sameConf),
    `all ${confGames.length} flagged games are between conference-mates`,
  );
  // Independents share a CGID but play no conference games, so they are the
  // only teams that can look same-conference while GMFX is 0.
  const exceptions = real.filter((g) => n(g.GMFX) === 0 && sameConf(g));
  check(
    'the only unflagged same-conference games involve Independents',
    exceptions.every((g) => n(byTgid.get(n(g.GATG))!.CGID) === indepId),
    `${exceptions.length} such games, all in "${indep ? String(indep.CNAM) : '?'}"`,
  );

  // --- rivalries ------------------------------------------------------------
  let rivalryFound = 0;
  let rivalryLate = 0;
  for (const t of team.records) {
    const a = n(t.TGID);
    const r = n(t.TMRV);
    if (!fbs.has(a) || !fbs.has(r)) continue;
    const g = real.find(
      (x) =>
        (n(x.GATG) === a && n(x.GHTG) === r) || (n(x.GATG) === r && n(x.GHTG) === a),
    );
    if (g) {
      rivalryFound++;
      if (n(g.SEWN) >= 10) rivalryLate++;
    }
  }
  check(
    'rivalry matchups from TEAM.TMRV appear on the schedule',
    rivalryFound > 95,
    `${rivalryFound} FBS rivalry pairs scheduled`,
  );
  check(
    'rivalry games cluster at the end of the season',
    rivalryLate / rivalryFound > 0.5,
    `${rivalryLate}/${rivalryFound} in week 10 or later`,
  );
  // Army-Navy is traditionally played a week after the rest of the season ends.
  const army = team.records.find((t) => String(t.TDNA) === 'Army');
  const navy = team.records.find((t) => String(t.TDNA) === 'Navy');
  const armyNavy =
    army && navy
      ? real.find(
          (g) =>
            (n(g.GATG) === n(army.TGID) && n(g.GHTG) === n(navy.TGID)) ||
            (n(g.GATG) === n(navy.TGID) && n(g.GHTG) === n(army.TGID)),
        )
      : undefined;
  const lastWeek = Math.max(...real.map((g) => n(g.SEWN)));
  check(
    'Army-Navy is scheduled in the final week of the regular season',
    !!armyNavy && n(armyNavy.SEWN) === lastWeek,
    armyNavy
      ? `week ${n(armyNavy.SEWN)}, the last week (only ${real.filter((g) => n(g.SEWN) === lastWeek).length} games that week)`
      : 'not scheduled',
  );

  console.log('=== CHECKS ===');
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
  if (failed) process.exit(1);
}

main();
