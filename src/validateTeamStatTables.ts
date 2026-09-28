/**
 * Validate TSSE (team season stats), PSKI (kicking/punting) and PSKP (returns).
 *
 * TSSE is the first table in the project that can be checked almost entirely
 * from OTHER tables we already trust: every offensive column is a sum of PSOF
 * rows, every defensive column is a sum of PSDE rows, and the whole table is
 * internally mirrored between opponents. That makes it unusually well pinned.
 *
 * The mirror test is the load-bearing one, and it comes with a control: true
 * opponent pairs mirror 82/82, while all 11,690 non-opponent pairings mirror
 * 0 times. Without that control the test would prove nothing (Lesson 15).
 */

import {
  FG_BUCKETS,
  POINTS_EXTRA_POINT,
  POINTS_FIELD_GOAL,
  POINTS_TOUCHDOWN,
  POINTS_TWO_POINT,
  POINTS_SAFETY,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
  signed16,
  PLAYER_POSITIONS,
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
  const load = (tag: string) => {
    const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { h, f, rows: readRecords(buf, h, f) as Record<string, number | string>[] };
  };

  const tsse = load('TSSE');
  const pski = load('PSKI');
  const pskp = load('PSKP');
  const psof = load('PSOF');
  const psde = load('PSDE');
  const schd = load('SCHD');
  const team = load('TEAM');
  const play = load('PLAY');

  const teamName = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));
  const posOf = new Map(
    play.rows.map((p) => [n(p.PGID), PLAYER_POSITIONS[n(p.PPOS)]]),
  );

  console.log(
    `TSSE: ${tsse.rows.length} rows / ${tsse.f.length} fields   ` +
      `PSKI: ${pski.rows.length} rows   PSKP: ${pskp.rows.length} rows\n`,
  );

  /* ---------------- shared derivations ---------------- */

  const played = schd.rows.filter(
    (g) => n(g.SEWN) === 0 && !(n(g.GHSC) === 0 && n(g.GASC) === 0),
  );
  const oppOf = new Map<number, number>();
  for (const g of played) {
    oppOf.set(n(g.GHTG), n(g.GATG));
    oppOf.set(n(g.GATG), n(g.GHTG));
  }
  const pointsFor = new Map<number, number>();
  for (const g of played) {
    pointsFor.set(n(g.GHTG), (pointsFor.get(n(g.GHTG)) ?? 0) + n(g.GHSC));
    pointsFor.set(n(g.GATG), (pointsFor.get(n(g.GATG)) ?? 0) + n(g.GASC));
  }

  const sumBy = (
    rows: Record<string, number | string>[],
    key: (r: Record<string, number | string>) => number,
  ) => {
    const m = new Map<number, number>();
    for (const r of rows) {
      const t = playerTeam(n(r.PGID));
      m.set(t, (m.get(t) ?? 0) + key(r));
    }
    return m;
  };
  const g0 = (m: Map<number, number>, t: number) => m.get(t) ?? 0;

  const passYds = sumBy(psof.rows, (r) => signed16(n(r.saya)));
  const rushYds = sumBy(psof.rows, (r) => signed16(n(r.suya)));
  const intThrown = sumBy(psof.rows, (r) => n(r.sain));
  const sacked = sumBy(psof.rows, (r) => n(r.sasa));
  const passTD = sumBy(psof.rows, (r) => n(r.satd));
  const rushTD = sumBy(psof.rows, (r) => n(r.sutd));
  const defSacks = sumBy(psde.rows, (r) => n(r.slsk));
  const defInt = sumBy(psde.rows, (r) => n(r.ssin));
  const fumRec = sumBy(psde.rows, (r) => n(r.slfr));
  const defTD = sumBy(psde.rows, (r) => n(r.ssdt));
  const retTD = sumBy(pskp.rows, (r) => n(r.srkt) + n(r.srpt));
  const kickRetYds = sumBy(pskp.rows, (r) => n(r.srky));
  const puntRetYds = sumBy(pskp.rows, (r) => n(r.srpy));
  const fgMade = sumBy(pski.rows, (r) => n(r.skfm));
  const xpMade = sumBy(pski.rows, (r) => n(r.skem));

  const hasStats = (t: number) => passYds.has(t);
  const rows = tsse.rows;
  const withStats = rows.filter((r) => hasStats(n(r.TGID)));
  const vsFbs = withStats.filter((r) => hasStats(oppOf.get(n(r.TGID)) ?? -1));

  /* ---------------- 1. row population ---------------- */

  const teamsPlayed = new Set<number>();
  for (const g of played) {
    teamsPlayed.add(n(g.GHTG));
    teamsPlayed.add(n(g.GATG));
  }
  const fbsPlayed = [...teamsPlayed].filter(hasStats);
  check(
    'TSSE has one row per FBS team that played',
    rows.length === fbsPlayed.length,
    `${rows.length} rows vs ${fbsPlayed.length} FBS teams in ${played.length} played games ` +
      `(${teamsPlayed.size} total participants, the rest are FCS with no roster)`,
  );
  check(
    'TGID is a primary key',
    new Set(rows.map((r) => n(r.TGID))).size === rows.length,
    `${new Set(rows.map((r) => n(r.TGID))).size} distinct of ${rows.length}`,
  );
  check(
    'every TSSE team actually played in week 0',
    rows.every((r) => teamsPlayed.has(n(r.TGID))),
    `${rows.filter((r) => teamsPlayed.has(n(r.TGID))).length}/${rows.length}`,
  );

  /* ---------------- 2. the mirror test, WITH CONTROL ---------------- */

  const mirrors = (
    a: Record<string, number | string>,
    b: Record<string, number | string>,
  ) => signed16(n(a.tsdp)) === signed16(n(b.tsop)) && signed16(n(a.tsdy)) === signed16(n(b.tsor));

  const byTgid = new Map(rows.map((r) => [n(r.TGID), r]));
  let mirrorOk = 0;
  let mirrorTot = 0;
  for (const g of played) {
    const a = byTgid.get(n(g.GATG));
    const h = byTgid.get(n(g.GHTG));
    if (!a || !h) continue;
    mirrorTot++;
    if (mirrors(a, h) && mirrors(h, a)) mirrorOk++;
  }
  check(
    'opponents mirror: my yards allowed == your yards gained',
    mirrorOk === mirrorTot,
    `${mirrorOk}/${mirrorTot} FBS-vs-FBS games`,
  );

  let ctrl = 0;
  let ctrlTot = 0;
  for (const a of rows) {
    for (const b of rows) {
      if (a === b) continue;
      if (oppOf.get(n(a.TGID)) === n(b.TGID)) continue;
      ctrlTot++;
      if (mirrors(a, b) && mirrors(b, a)) ctrl++;
    }
  }
  check(
    'CONTROL: non-opponent pairs do NOT mirror',
    ctrl === 0,
    `${ctrl}/${ctrlTot} false positives -- this is what makes the mirror test evidence`,
  );

  for (const [own, allowed] of [
    ['tssa', 'tssk'],
    ['tspi', 'tsDi'],
    ['tsfl', 'tsfr'],
    ['tsof', 'tsdf'],
    ['tsta', 'tsga'],
  ] as const) {
    let ok = 0;
    for (const r of vsFbs) {
      const o = byTgid.get(oppOf.get(n(r.TGID))!);
      if (o && n(r[own]) === n(o[allowed])) ok++;
    }
    check(
      `mirror pair ${own} <-> opponent ${allowed}`,
      ok === vsFbs.length,
      `${ok}/${vsFbs.length}`,
    );
  }

  /* ---------------- 3. cross-table sums ---------------- */

  const crossTests: [string, (r: Record<string, number | string>) => [number, number]][] = [
    ['tsop == sum of PSOF passing yards', (r) => [signed16(n(r.tsop)), g0(passYds, n(r.TGID))]],
    ['tsor == sum of PSOF rushing yards', (r) => [signed16(n(r.tsor)), g0(rushYds, n(r.TGID))]],
    ['tspi == sum of PSOF interceptions thrown', (r) => [n(r.tspi), g0(intThrown, n(r.TGID))]],
    ['tssa == sum of PSOF sacks taken', (r) => [n(r.tssa), g0(sacked, n(r.TGID))]],
    ['tsPt == sum of PSOF passing touchdowns', (r) => [n(r.tsPt), g0(passTD, n(r.TGID))]],
    ['tsrt == sum of PSOF rushing touchdowns', (r) => [n(r.tsrt), g0(rushTD, n(r.TGID))]],
    ['tssk == sum of PSDE sacks', (r) => [n(r.tssk), g0(defSacks, n(r.TGID))]],
    ['tsDi == sum of PSDE interceptions', (r) => [n(r.tsDi), g0(defInt, n(r.TGID))]],
    ['tsfr == sum of PSDE fumble recoveries', (r) => [n(r.tsfr), g0(fumRec, n(r.TGID))]],
    [
      'tsty == PSKP kick + punt return yards',
      (r) => [n(r.tsty), g0(kickRetYds, n(r.TGID)) + g0(puntRetYds, n(r.TGID))],
    ],
  ];
  for (const [label, f] of crossTests) {
    let ok = 0;
    for (const r of withStats) {
      const [a, b] = f(r);
      if (a === b) ok++;
    }
    check(label, ok === withStats.length, `${ok}/${withStats.length}`);
  }

  // control for the cross-table sums
  let shiftOk = 0;
  for (let i = 0; i < withStats.length; i++) {
    const t = n(withStats[(i + 1) % withStats.length].TGID);
    if (signed16(n(withStats[i].tsop)) === g0(passYds, t)) shiftOk++;
  }
  check(
    'CONTROL: tsop does not match a SHIFTED team',
    shiftOk <= 2,
    `${shiftOk}/${withStats.length} (a dense small-int space always gives a few)`,
  );

  /* ---------------- 4. internal arithmetic ---------------- */

  let totOk = 0;
  for (const r of rows) {
    if (signed16(n(r.tsor)) + signed16(n(r.tsop)) === signed16(n(r.tsoy))) totOk++;
  }
  check(
    'tsor + tsop == tsoy (total offense), read SIGNED',
    totOk === rows.length,
    `${totOk}/${rows.length} -- Idaho holds 65535 rushing yards, i.e. -1`,
  );

  let allYdOk = 0;
  for (const r of rows) {
    if (signed16(n(r.tsoy)) + n(r.tsty) === signed16(n(r.tsTy))) allYdOk++;
  }
  check(
    'tsoy + tsty == tsTy (all-purpose yards)',
    allYdOk === rows.length,
    `${allYdOk}/${rows.length}`,
  );

  const downTests: [string, (r: Record<string, number | string>) => boolean][] = [
    ['ts3c <= ts3d (third-down conversions <= attempts)', (r) => n(r.ts3c) <= n(r.ts3d)],
    ['ts4c <= ts4d (fourth-down conversions <= attempts)', (r) => n(r.ts4c) <= n(r.ts4d)],
    ['ts2c <= ts2a (two-point conversions <= attempts)', (r) => n(r.ts2c) <= n(r.ts2a)],
    ['tsPy == 0 exactly when tspe == 0 (penalty yards vs count)', (r) => (n(r.tsPy) === 0) === (n(r.tspe) === 0)],
    [
      'penalty yards are 4..15 per penalty',
      (r) => n(r.tspe) === 0 || (n(r.tsPy) >= n(r.tspe) * 4 && n(r.tsPy) <= n(r.tspe) * 15),
    ],
  ];
  for (const [label, f] of downTests) {
    const ok = rows.filter(f).length;
    check(label, ok === rows.length, `${ok}/${rows.length}`);
  }

  /* ---------------- 5. points reconstruction ---------------- */

  let exact = 0;
  const safeties: string[] = [];
  for (const r of withStats) {
    const t = n(r.TGID);
    const td = g0(passTD, t) + g0(rushTD, t) + g0(defTD, t) + g0(retTD, t);
    const calc =
      POINTS_TOUCHDOWN * td +
      POINTS_EXTRA_POINT * g0(xpMade, t) +
      POINTS_FIELD_GOAL * g0(fgMade, t) +
      POINTS_TWO_POINT * n(r.ts2c);
    const diff = (pointsFor.get(t) ?? 0) - calc;
    if (diff === 0) exact++;
    else if (diff === POINTS_SAFETY) safeties.push(String(teamName.get(t)));
  }
  check(
    'final score reconstructs from touchdowns, PATs, field goals and 2pt',
    exact + safeties.length === withStats.length,
    `${exact}/${withStats.length} exact; the other ${safeties.length} are short by exactly ` +
      `${POINTS_SAFETY} (a safety): ${safeties.join(', ')}`,
  );

  /* ---------------- 6. PSKI kicking ---------------- */

  const kRows = pski.rows;
  const kTests: [string, (r: Record<string, number | string>) => boolean][] = [
    [
      'skfa == sum of the five distance-bucket attempts',
      (r) => n(r.skfa) === FG_BUCKETS.reduce((s, b) => s + n(r[b.att]), 0),
    ],
    [
      'skfm == sum of the five distance-bucket makes',
      (r) => n(r.skfm) === FG_BUCKETS.reduce((s, b) => s + n(r[b.made]), 0),
    ],
    ['makes <= attempts in every bucket', (r) => FG_BUCKETS.every((b) => n(r[b.made]) <= n(r[b.att]))],
    ['skem <= skea (extra points made <= attempted)', (r) => n(r.skem) <= n(r.skea)],
    ['skfL > 0 exactly when a field goal was made', (r) => (n(r.skfL) > 0) === (n(r.skfm) > 0)],
    ['spya >= spny (gross punt yards >= net)', (r) => n(r.spya) >= n(r.spny)],
    ['spat > 0 exactly when spya > 0', (r) => (n(r.spat) > 0) === (n(r.spya) > 0)],
    ['sptb <= spat (touchbacks <= punts)', (r) => n(r.sptb) <= n(r.spat)],
    ['sppt <= spat (punts inside the 20 <= punts)', (r) => n(r.sppt) <= n(r.spat)],
    ['sktb <= sknk (kickoff touchbacks <= kickoffs)', (r) => n(r.sktb) <= n(r.sknk)],
  ];
  for (const [label, f] of kTests) {
    const ok = kRows.filter(f).length;
    check(label, ok === kRows.length, `${ok}/${kRows.length}`);
  }

  // the bucket ORDER is pinned by the long-FG column
  let bucketOk = 0;
  let bucketTot = 0;
  for (const r of kRows) {
    if (n(r.skfm) === 0) continue;
    let top = -1;
    FG_BUCKETS.forEach((b, i) => {
      if (n(r[b.made]) > 0) top = i;
    });
    if (top < 0) continue;
    bucketTot++;
    const b = FG_BUCKETS[top];
    if (n(r.skfL) >= b.min && n(r.skfL) <= b.max) bucketOk++;
  }
  check(
    'longest field goal falls inside the highest bucket that has a make',
    bucketOk === bucketTot,
    `${bucketOk}/${bucketTot} -- this is what pins the bucket DISTANCES ` +
      `(${FG_BUCKETS.map((b) => b.label).join(', ')}), rather than assuming them`,
  );

  const kickers = kRows.filter((r) => n(r.skfa) > 0);
  const kickerK = kickers.filter((r) => posOf.get(n(r.PGID)) === 'K').length;
  check(
    'field goals are attempted by kickers',
    kickerK >= kickers.length - 1,
    `${kickerK}/${kickers.length} are K (the remainder is a punter, which is normal)`,
  );
  const punters = kRows.filter((r) => n(r.spat) > 0);
  const punterP = punters.filter((r) => posOf.get(n(r.PGID)) === 'P').length;
  check(
    'punts are taken by punters',
    punterP >= punters.length * 0.9,
    `${punterP}/${punters.length} are P (the rest are kickers doubling up)`,
  );

  const makeRates = FG_BUCKETS.map((b) => {
    const att = kRows.reduce((s, r) => s + n(r[b.att]), 0);
    const made = kRows.reduce((s, r) => s + n(r[b.made]), 0);
    return { label: b.label, att, made, pct: att ? made / att : 1 };
  });
  const monotone = makeRates.every(
    (m, i) => i === 0 || m.pct <= makeRates[i - 1].pct + 0.02,
  );
  check(
    'field goal accuracy falls as distance rises',
    monotone,
    makeRates.map((m) => `${m.label} ${m.made}/${m.att}`).join('  '),
  );

  /* ---------------- 7. PSKP returns ---------------- */

  const rRows = pskp.rows;
  const rTests: [string, (r: Record<string, number | string>) => boolean][] = [
    ['kick return yards require a kick return', (r) => !(n(r.srky) > 0 && n(r.srka) === 0)],
    ['punt return yards require a punt return', (r) => !(n(r.srpy) > 0 && n(r.srpa) === 0)],
    ['srkt <= srka (kick return TDs <= returns)', (r) => n(r.srkt) <= n(r.srka)],
    ['srpt <= srpa (punt return TDs <= returns)', (r) => n(r.srpt) <= n(r.srpa)],
    ['srkL <= srky (longest <= total kick return yards)', (r) => n(r.srka) === 0 || n(r.srkL) <= n(r.srky)],
    ['srpL <= srpy (longest <= total punt return yards)', (r) => n(r.srpa) === 0 || n(r.srpL) <= n(r.srpy)],
  ];
  for (const [label, f] of rTests) {
    const ok = rRows.filter(f).length;
    check(label, ok === rRows.length, `${ok}/${rRows.length}`);
  }

  const returners = rRows.filter((r) => n(r.srka) + n(r.srpa) > 0);
  const skill = new Set(['WR', 'CB', 'HB', 'FS', 'SS', 'FB', 'TE']);
  const skillOk = returners.filter((r) => skill.has(posOf.get(n(r.PGID)) ?? '')).length;
  check(
    'returners are skill-position players',
    skillOk === returners.length,
    `${skillOk}/${returners.length} are WR/CB/HB/FS/SS/FB/TE -- no linemen return kicks`,
  );

  /* ---------------- 8. per-game scope ---------------- */

  check(
    'PSKI rows are per-game lines (sgmp == 1)',
    kRows.every((r) => n(r.sgmp) === 1),
    `${kRows.filter((r) => n(r.sgmp) === 1).length}/${kRows.length}`,
  );
  check(
    'PSKP rows are per-game lines (sgmp == 1)',
    rRows.every((r) => n(r.sgmp) === 1),
    `${rRows.filter((r) => n(r.sgmp) === 1).length}/${rRows.length}`,
  );

  /* ---------------- report ---------------- */

  let failed = 0;
  for (const c of checks) {
    if (!c.pass) failed++;
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`);
  }
  console.log(
    `\n${checks.length - failed}/${checks.length} checks passed` +
      (failed === 0 ? ' -- All checks passed' : ''),
  );
  if (failed) process.exitCode = 1;
}

main();
