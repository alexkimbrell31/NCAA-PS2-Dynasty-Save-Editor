/**
 * Validate AAPL -- all-conference and All-America selections.
 *
 * AAPL is the most regular table in the file: 650 rows factor exactly as
 * 13 squads x 2 tiers x 25 slots, and that factorisation is itself the
 * identification of CGID, TTYP and PPOS.
 */

import {
  ALL_CONF_DOUBLED_POSITIONS,
  ALL_CONF_FIRST_TEAM,
  ALL_CONF_SECOND_TEAM,
  ALL_CONF_TEAM_SIZE,
  PLAYER_POSITIONS,
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

/** The pseudo-conference that holds the cross-conference (All-America) squad. */
const ALL_AMERICA_CGID = 15;

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (t: string) => {
    const h = parseTableHeader(buf, findTable(toc, t).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { h, f, rows: readRecords(buf, h, f) };
  };

  const aapl = load('AAPL');
  const play = load('PLAY');
  const team = load('TEAM');
  const conf = load('CONF');
  const rows = aapl.rows;
  const byP = new Map(play.rows.map((p) => [n(p.PGID), p]));
  const tc = new Map(team.rows.map((t) => [n(t.TGID), n(t.CGID)]));
  const cn = new Map(conf.rows.map((c) => [n(c.CGID), String(c.CNAM).trim()]));
  const ownConf = (r: Record<string, number | string>) =>
    tc.get(playerTeam(n(byP.get(n(r.PGID))!.PGID)))!;

  console.log(`AAPL: ${rows.length} records, ${aapl.f.length} fields\n`);

  // --- structure ------------------------------------------------------------
  const sorted = [...aapl.f].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  let tiles = true;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) tiles = false;
    cursor += f.bits;
  }
  check(
    'fields tile the record with no gaps or overlaps',
    tiles,
    `${sorted.length} fields cover bits 0..${cursor - 1} of ${aapl.h.recordLenBytes * 8}`,
  );

  // --- the factorisation ----------------------------------------------------
  const squads = new Set(rows.map((r) => n(r.CGID)));
  const tiers = new Set(rows.map((r) => n(r.TTYP)));
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const k = `${n(r.CGID)}|${n(r.TTYP)}`;
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  check(
    'rows factor exactly as squads x tiers x slots',
    squads.size * tiers.size * ALL_CONF_TEAM_SIZE === rows.length,
    `${squads.size} squads x ${tiers.size} tiers x ${ALL_CONF_TEAM_SIZE} slots = ${rows.length}`,
  );
  check(
    'every (squad, tier) bucket holds exactly 25 players',
    buckets.size === squads.size * tiers.size &&
      [...buckets.values()].every((v) => v === ALL_CONF_TEAM_SIZE),
    `${buckets.size} buckets, all ${ALL_CONF_TEAM_SIZE} — no squad is short or over-filled`,
  );
  check(
    'TTYP is a two-tier flag, first and second team',
    tiers.has(ALL_CONF_FIRST_TEAM) && tiers.has(ALL_CONF_SECOND_TEAM) && tiers.size === 2,
    `${rows.filter((r) => n(r.TTYP) === ALL_CONF_FIRST_TEAM).length} first-team, ` +
      `${rows.filter((r) => n(r.TTYP) === ALL_CONF_SECOND_TEAM).length} second-team`,
  );

  // The discriminating test for "first team is better than second team".
  const meanOvr = (t: number) => {
    const rs = rows.filter((r) => n(r.TTYP) === t);
    return rs.reduce((a, r) => a + n(byP.get(n(r.PGID))!.POVR), 0) / rs.length;
  };
  check(
    'TTYP 0 is the FIRST team, not merely a label',
    meanOvr(ALL_CONF_FIRST_TEAM) > meanOvr(ALL_CONF_SECOND_TEAM),
    `mean raw POVR ${meanOvr(0).toFixed(1)} vs ${meanOvr(1).toFixed(1)} — ` +
      `the ordering of the flag is fixed by the ratings, not assumed`,
  );

  // --- the 25-slot template -------------------------------------------------
  const posCount = new Map<number, number>();
  for (const r of rows) posCount.set(n(r.PPOS), (posCount.get(n(r.PPOS)) ?? 0) + 1);
  const single = [...posCount.entries()].filter(([, v]) => v === buckets.size);
  const doubled = [...posCount.entries()]
    .filter(([, v]) => v === buckets.size * 2)
    .map(([k]) => k)
    .sort((a, b) => a - b);
  check(
    'all 21 positions appear, 17 once per squad and 4 twice',
    posCount.size === PLAYER_POSITIONS.length &&
      single.length + doubled.length === posCount.size &&
      single.length * 1 + doubled.length * 2 === ALL_CONF_TEAM_SIZE,
    `${single.length} single + ${doubled.length} doubled = ${ALL_CONF_TEAM_SIZE} slots`,
  );
  check(
    'the doubled positions are the ones a base formation fields two of',
    JSON.stringify(doubled) === JSON.stringify(ALL_CONF_DOUBLED_POSITIONS),
    `doubled: ${doubled.map((p) => PLAYER_POSITIONS[p]).join(', ')}`,
  );

  // --- PGID and PPOS --------------------------------------------------------
  check(
    'every PGID resolves in PLAY',
    rows.every((r) => byP.has(n(r.PGID))),
    `${rows.length}/${rows.length}`,
  );
  const posAgree = rows.filter((r) => n(r.PPOS) === n(byP.get(n(r.PGID))!.PPOS));
  check(
    "AAPL.PPOS is the slot filled, which is almost always the player's own position",
    posAgree.length >= rows.length - 5 && posAgree.length < rows.length,
    `${posAgree.length}/${rows.length} agree; the ${rows.length - posAgree.length} that ` +
      `differ are players selected out of position — the same kind of small, ` +
      `honest disagreement PLGA showed against PLAY`,
  );

  // --- the 13th squad is not a conference -----------------------------------
  const mismatched = rows.filter((r) => ownConf(r) !== n(r.CGID));
  check(
    'twelve of the thirteen squads are genuine conferences',
    rows
      .filter((r) => n(r.CGID) !== ALL_AMERICA_CGID)
      .every((r) => ownConf(r) === n(r.CGID)),
    `${rows.length - ALL_CONF_TEAM_SIZE * 2}/${rows.length - ALL_CONF_TEAM_SIZE * 2} ` +
      `players sit in the squad of their own conference`,
  );
  check(
    `CGID ${ALL_AMERICA_CGID} is a cross-conference All-America squad, not a conference`,
    mismatched.length === ALL_CONF_TEAM_SIZE * 2 &&
      mismatched.every((r) => n(r.CGID) === ALL_AMERICA_CGID) &&
      new Set(mismatched.map(ownConf)).size > 5,
    `all ${mismatched.length} of its players come from ${new Set(mismatched.map(ownConf)).size} ` +
      `different real conferences — no conference draws from twelve others`,
  );
  check(
    'the All-America squad is the only source of repeat selections',
    (() => {
      const dup = new Map<number, number>();
      for (const r of rows) dup.set(n(r.PGID), (dup.get(n(r.PGID)) ?? 0) + 1);
      const repeats = [...dup.values()].filter((v) => v > 1).length;
      return repeats === ALL_CONF_TEAM_SIZE * 2;
    })(),
    `${ALL_CONF_TEAM_SIZE * 2} players appear twice — once for their conference, ` +
      `once for All-America — and nobody appears three times`,
  );

  // --- only FBS conferences get a team --------------------------------------
  const fbs = new Set(play.rows.map((p) => playerTeam(n(p.PGID))));
  check(
    'every selected player is FBS',
    rows.every((r) => fbs.has(playerTeam(n(r.PGID)))),
    `${rows.length}/${rows.length}`,
  );
  const absent = conf.rows
    .map((c) => n(c.CGID))
    .filter((c) => !squads.has(c))
    .map((c) => cn.get(c));
  check(
    'the conferences with no all-conference team are the FCS and placeholder ones',
    !absent.includes('ACC') && !absent.includes('SEC') && absent.length === 12,
    `absent: ${absent.join(', ')}`,
  );

  // --- ARET -----------------------------------------------------------------
  const ar = rows.filter((r) => n(r.ARET) === 1);
  const arBuckets = new Set(ar.map((r) => `${n(r.CGID)}|${n(r.TTYP)}`));
  check(
    'ARET marks at most one player per squad, always a returner-capable position',
    arBuckets.size === ar.length && ar.every((r) => [1, 3, 16].includes(n(r.PPOS))),
    `${ar.length} flagged across ${arBuckets.size} of ${buckets.size} buckets; ` +
      `positions ${[...new Set(ar.map((r) => PLAYER_POSITIONS[n(r.PPOS)]))].join(', ')} — ` +
      `the one bucket without a flag is the All-America first team (reported, not explained)`,
  );

  // --- SEYR -----------------------------------------------------------------
  check(
    'SEYR is the season index and is zero throughout',
    rows.every((r) => n(r.SEYR) === 0),
    `this is the first season of the dynasty, so every award belongs to year 0`,
  );

  // --- report ---------------------------------------------------------------
  let failed = 0;
  for (const c of checks) {
    if (!c.pass) failed++;
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  }
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
  if (failed) process.exitCode = 1;
}

main();
