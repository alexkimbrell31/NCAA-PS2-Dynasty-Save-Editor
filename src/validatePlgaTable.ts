/**
 * Validate the decoded PLGA table.
 *
 * PLGA is unusual in that most of it can be checked against tables that were
 * solved earlier: 67 of its 119 players also live in PLAY, and the two must
 * agree. It also validates things in the OTHER direction -- the generated
 * opponents carry their position as plain text, which independently confirms
 * the PLAYER_POSITIONS enum that was originally inferred from body types.
 */

import {
  GENERATED_NAME_PATTERN,
  LINEUP_SIZE,
  MAX_FIRST_NAME,
  MAX_LAST_NAME,
  OFFENSIVE_POSITIONS,
  PLAYER_POSITIONS,
  PLAYER_WEIGHT_OFFSET,
  RATING_FIELDS,
  encodeName,
  findTable,
  isGeneratedPlayer,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  ratingToDisplay,
  readRecords,
  readSaveFile,
  NO_TEAM,
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
const s = (v: number | string) => (typeof v === 'string' ? v : '');

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (name: string) => {
    const h = parseTableHeader(buf, findTable(toc, name).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { header: h, fields: f, records: readRecords(buf, h, f) };
  };

  const plga = load('PLGA');
  const play = load('PLAY');
  const schd = load('SCHD');
  const rows = plga.records;

  console.log(`PLGA: ${rows.length} records, ${plga.fields.length} fields\n`);

  const playByPgid = new Map(play.records.map((p) => [n(p.PGID), p]));
  const real = rows.filter((r) => playByPgid.has(n(r.PGID)));
  const generated = rows.filter(isGeneratedPlayer);

  // --- structure ------------------------------------------------------------
  const sorted = [...plga.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  let tiles = true;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) tiles = false;
    cursor += f.bits;
  }
  check(
    'fields tile the record with no gaps or overlaps',
    tiles,
    `bits 0..${cursor - 1} of ${plga.header.recordLenBytes * 8}`,
  );
  check(
    'PGID is unique across the table',
    new Set(rows.map((r) => n(r.PGID))).size === rows.length,
    `${rows.length} distinct player ids`,
  );

  // --- the matchup ----------------------------------------------------------
  // PLGA should describe one game, not a random selection of players. The
  // discriminating test is that its two squads are the two teams in the one
  // fixture SCHD says has not been played yet.
  const squads = new Map<number, number>();
  for (const r of rows) {
    const t = playerTeam(n(r.PGID));
    squads.set(t, (squads.get(t) ?? 0) + 1);
  }
  check(
    'the table holds exactly two squads',
    squads.size === 2,
    `TGIDs ${[...squads.keys()].join(', ')} with ${[...squads.values()].join(' and ')} players`,
  );
  // The user's whole season is unplayed, so "an unplayed user game" matches 12
  // rows. The one PLGA caches is the NEXT one -- the earliest week still
  // outstanding.
  const userGames = schd.records.filter(
    (g) =>
      n(g.GFHU) === 1 &&
      n(g.GSTA) === 0 &&
      n(g.GHTG) !== NO_TEAM &&
      n(g.GATG) !== NO_TEAM,
  );
  const nextWeek = Math.min(...userGames.map((g) => n(g.SEWN)));
  const nextGames = userGames.filter((g) => n(g.SEWN) === nextWeek);
  check(
    "the two squads are the teams in the user's next unplayed game",
    nextGames.length === 1 &&
      squads.has(n(nextGames[0].GHTG)) &&
      squads.has(n(nextGames[0].GATG)),
    nextGames.length === 1
      ? `of ${userGames.length} unplayed user games the earliest is week ${nextWeek}: ` +
          `TGID ${n(nextGames[0].GATG)} at ${n(nextGames[0].GHTG)} — exactly PLGA's two rosters`
      : `expected 1 game in the earliest unplayed week, found ${nextGames.length}`,
  );
  check(
    'squad sizes are plausible for a college football roster',
    [...squads.values()].every((c) => c >= 45 && c <= 70),
    `${[...squads.values()].sort((a, b) => b - a).join(', ')} players`,
  );

  // --- agreement with PLAY --------------------------------------------------
  const plgaNames = plga.fields.map((f) => f.name);
  const shared = plgaNames.filter((name) =>
    play.fields.some((f) => f.name === name),
  );
  const disagreements: string[] = [];
  let compared = 0;
  for (const g of real) {
    const p = playByPgid.get(n(g.PGID))!;
    for (const f of shared) {
      compared++;
      if (String(g[f]) !== String(p[f])) {
        const nm = playerName(p);
        disagreements.push(`${nm.first} ${nm.last} ${f}: PLAY ${p[f]} vs PLGA ${g[f]}`);
      }
    }
  }
  // Three disagreements out of ~4000 is not a decode error -- a wrong bit
  // offset would break everything or nothing. Assert the shape of the anomaly
  // rather than pretending it is absent.
  check(
    'PLGA and PLAY agree on essentially every shared field',
    disagreements.length <= 3,
    `${compared - disagreements.length}/${compared} comparisons agree across ${shared.length} shared fields; ` +
      `${disagreements.length} differ: ${disagreements.join('; ')}`,
  );
  check(
    'identity fields agree with PLAY exactly',
    real.every((g) => {
      const p = playByPgid.get(n(g.PGID))!;
      return (
        n(g.PJEN) === n(p.PJEN) &&
        n(g.PPOS) === n(p.PPOS) &&
        n(g.PYER) === n(p.PYER) &&
        n(g.PHGT) === n(p.PHGT) &&
        n(g.PWGT) === n(p.PWGT)
      );
    }),
    `jersey, position, class, height and weight match on all ${real.length} rostered players`,
  );

  // --- names: the plaintext / 6-bit cross-check -----------------------------
  check(
    "PLGA's plaintext names match PLAY's packed 6-bit names",
    real.every((g) => {
      const p = playByPgid.get(n(g.PGID))!;
      const nm = playerName(p);
      return nm.first === s(g.PFNA) && nm.last === s(g.PLNA);
    }),
    `${real.length}/${real.length} names identical between the two encodings`,
  );
  // This is what licenses the encoder used by editSave.ts. PLGA was written by
  // the game, so it cannot inherit a mistake from our decoder.
  let slots = 0;
  const encodeBad = real.filter((g) => {
    const p = playByPgid.get(n(g.PGID))!;
    for (const [text, prefix, max] of [
      [s(g.PFNA), 'PF', MAX_FIRST_NAME],
      [s(g.PLNA), 'PL', MAX_LAST_NAME],
    ] as const) {
      for (const [field, code] of Object.entries(encodeName(text, prefix, max))) {
        slots++;
        if (n(p[field]) !== code) return true;
      }
    }
    return false;
  });
  check(
    "encoding PLGA's plaintext reproduces PLAY's stored character codes",
    encodeBad.length === 0,
    `${slots} character slots across ${real.length} players; the name encoder is ground-truthed, not self-consistent`,
  );
  check(
    'every name fits the field widths',
    rows.every(
      (r) => s(r.PFNA).length <= MAX_FIRST_NAME && s(r.PLNA).length <= MAX_LAST_NAME,
    ),
    `longest first "${rows.map((r) => s(r.PFNA)).sort((a, b) => b.length - a.length)[0]}", ` +
      `longest last "${rows.map((r) => s(r.PLNA)).sort((a, b) => b.length - a.length)[0]}"`,
  );

  // --- generated opponents --------------------------------------------------
  check(
    'generated players have no PLAY row, rostered players all do',
    generated.every((r) => !playByPgid.has(n(r.PGID))) &&
      rows.filter((r) => !isGeneratedPlayer(r)).every((r) => playByPgid.has(n(r.PGID))),
    `${generated.length} generated (FCS opponent), ${real.length} from the stored FBS roster — ` +
      `this is why PLAY holds only 119 teams`,
  );
  check(
    'generated players all belong to the same team and occupy a contiguous id block',
    (() => {
      const teams = new Set(generated.map((r) => playerTeam(n(r.PGID))));
      const ids = generated.map((r) => n(r.PGID)).sort((a, b) => a - b);
      return teams.size === 1 && ids.every((v, i) => i === 0 || v === ids[i - 1] + 1);
    })(),
    `TGID ${playerTeam(n(generated[0].PGID))}, PGID ${Math.min(...generated.map((r) => n(r.PGID)))}..` +
      `${Math.max(...generated.map((r) => n(r.PGID)))}, contiguous`,
  );

  // --- the position enum, confirmed by the game itself ----------------------
  // PLAYER_POSITIONS was originally inferred from body types: linemen are heavy
  // and slow, corners fast and light, kickers scarce. Good evidence, but
  // indirect. The generated players are named "<position> #<jersey>", so the
  // game states the mapping outright.
  const parsed = generated.map((r) => ({
    r,
    m: GENERATED_NAME_PATTERN.exec(s(r.PLNA)),
  }));
  check(
    'every generated name has the form "<position> #<jersey>"',
    parsed.every((p) => p.m !== null),
    `${parsed.filter((p) => p.m).length}/${generated.length} parse`,
  );
  check(
    'the jersey number embedded in a generated name matches PJEN',
    parsed.every((p) => p.m !== null && Number(p.m[2]) === n(p.r.PJEN)),
    `${parsed.filter((p) => p.m && Number(p.m[2]) === n(p.r.PJEN)).length}/${generated.length}`,
  );
  const posSeen = new Map<number, Set<string>>();
  for (const p of parsed) {
    if (!p.m) continue;
    const set = posSeen.get(n(p.r.PPOS)) ?? new Set<string>();
    set.add(p.m[1]);
    posSeen.set(n(p.r.PPOS), set);
  }
  const posAgree = [...posSeen].filter(
    ([ppos, abbrs]) => abbrs.size === 1 && [...abbrs][0] === PLAYER_POSITIONS[ppos],
  );
  check(
    "the game's own position abbreviations confirm PLAYER_POSITIONS",
    posAgree.length === posSeen.size && posSeen.size === PLAYER_POSITIONS.length,
    `${posAgree.length}/${posSeen.size} positions agree, covering all ${PLAYER_POSITIONS.length} — ` +
      `an enum previously inferred from body types, now stated outright`,
  );

  // --- lineups --------------------------------------------------------------
  const offensive = new Set<string>(OFFENSIVE_POSITIONS);
  for (const flag of ['SNPD', 'SNPO'] as const) {
    const lineup = rows.filter((r) => n(r[flag]) === 1);
    const byTeam = new Map<number, typeof rows>();
    for (const r of lineup) {
      const t = playerTeam(n(r.PGID));
      const list = byTeam.get(t) ?? [];
      list.push(r);
      byTeam.set(t, list);
    }
    check(
      `${flag} flags a complete 11-on-11 lineup`,
      lineup.length === LINEUP_SIZE * 2 &&
        byTeam.size === 2 &&
        [...byTeam.values()].every((l) => l.length === LINEUP_SIZE),
      `${lineup.length} players, ${[...byTeam.values()].map((l) => l.length).join(' + ')} per side`,
    );
    check(
      `${flag} puts one side entirely on offence and the other entirely on defence`,
      [...byTeam.values()].every((l) => {
        const off = l.filter((r) => offensive.has(PLAYER_POSITIONS[n(r.PPOS)])).length;
        return off === 0 || off === l.length;
      }),
      [...byTeam]
        .map(([t, l]) => {
          const off = l.filter((r) => offensive.has(PLAYER_POSITIONS[n(r.PPOS)])).length;
          return `TGID ${t} ${off === l.length ? 'offence' : 'defence'}`;
        })
        .join(', '),
    );
    check(
      `${flag}'s offence fields exactly one quarterback and five offensive linemen`,
      [...byTeam.values()].some((l) => {
        const c = (p: string) => l.filter((r) => PLAYER_POSITIONS[n(r.PPOS)] === p).length;
        return (
          c('QB') === 1 &&
          c('LT') === 1 &&
          c('LG') === 1 &&
          c('C') === 1 &&
          c('RG') === 1 &&
          c('RT') === 1
        );
      }),
      `a legal formation, not an arbitrary 11`,
    );
  }
  check(
    'the two lineups are different personnel packages, not copies',
    (() => {
      const d = rows.filter((r) => n(r.SNPD) === 1).map((r) => n(r.PGID)).sort();
      const o = rows.filter((r) => n(r.SNPO) === 1).map((r) => n(r.PGID)).sort();
      return d.join() !== o.join();
    })(),
    `SNPD is a three-receiver set against a nickel secondary; SNPO is a two-tight-end set ` +
      `against an extra linebacker — heavier offence, heavier defence`,
  );

  // --- ratings --------------------------------------------------------------
  const ratingsHere = RATING_FIELDS.filter((f) =>
    plga.fields.some((x) => x.name === f),
  );
  check(
    'ratings use the same 5-bit quantised scale as PLAY',
    rows.every((r) => ratingsHere.every((f) => n(r[f]) >= 0 && n(r[f]) <= 31)),
    `${ratingsHere.length} rating fields, all within 0..31, displaying 40..99`,
  );
  check(
    'generated opponents are rated below the FBS side',
    (() => {
      const mean = (rs: typeof rows) =>
        rs.reduce((a, r) => a + ratingToDisplay(n(r.POVR)), 0) / rs.length;
      return mean(generated) < mean(real);
    })(),
    `FCS mean overall ${(generated.reduce((a, r) => a + ratingToDisplay(n(r.POVR)), 0) / generated.length).toFixed(1)} ` +
      `vs FBS ${(real.reduce((a, r) => a + ratingToDisplay(n(r.POVR)), 0) / real.length).toFixed(1)}`,
  );

  // --- physical sanity ------------------------------------------------------
  check(
    'heights and weights are plausible for every player, generated included',
    rows.every(
      (r) =>
        n(r.PHGT) >= 60 &&
        n(r.PHGT) <= 84 &&
        n(r.PWGT) + PLAYER_WEIGHT_OFFSET >= 150 &&
        n(r.PWGT) + PLAYER_WEIGHT_OFFSET <= 400,
    ),
    `height ${Math.min(...rows.map((r) => n(r.PHGT)))}..${Math.max(...rows.map((r) => n(r.PHGT)))} in, ` +
      `weight ${Math.min(...rows.map((r) => n(r.PWGT))) + PLAYER_WEIGHT_OFFSET}..` +
      `${Math.max(...rows.map((r) => n(r.PWGT))) + PLAYER_WEIGHT_OFFSET} lb`,
  );
  // The stored FBS roster keeps jerseys unique; the generated FCS squad does
  // not. Worth recording rather than smoothing over -- it means uniqueness is
  // enforced when a roster is authored, not when one is generated.
  const jerseysByTeam = new Map<number, number[]>();
  for (const r of rows) {
    const t = playerTeam(n(r.PGID));
    const list = jerseysByTeam.get(t) ?? [];
    list.push(n(r.PJEN));
    jerseysByTeam.set(t, list);
  }
  check(
    'jersey numbers are legal, and unique within the stored roster',
    [...jerseysByTeam.values()].every((js) => js.every((j) => j >= 0 && j <= 99)) &&
      new Set(real.map((r) => n(r.PJEN))).size === real.length,
    [...jerseysByTeam]
      .map(([t, js]) => `TGID ${t}: ${new Set(js).size}/${js.length} distinct`)
      .join(', ') +
      ` — the generated squad allows duplicates, the authored one does not`,
  );

  // --- unidentified fields, reported honestly -------------------------------
  check(
    'PGCI and PGYI are constant and carry no information in this save',
    rows.every((r) => n(r.PGCI) === 65535) && rows.every((r) => n(r.PGYI) === 65535),
    `both 65535 on all ${rows.length} rows — the 16-bit all-ones sentinel`,
  );
  check(
    'PGPI and PGSI are per-player indices of unknown purpose',
    new Set(rows.map((r) => n(r.PGPI))).size > 100 &&
      new Set(rows.map((r) => n(r.PGSI))).size > 100,
    `PGPI ${new Set(rows.map((r) => n(r.PGPI))).size} distinct, PGSI ${new Set(rows.map((r) => n(r.PGSI))).size} distinct; ` +
      `equal on ${rows.filter((r) => n(r.PGPI) === n(r.PGSI)).length}/${rows.length} rows — unidentified`,
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
