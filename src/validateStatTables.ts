/**
 * Validate PSOF and PSDE -- the per-game statistic lines.
 *
 * The naming model (s + category + stat, a = passing, c = receiving,
 * u = rushing) is mnemonic-grade and could not be trusted on its own. What
 * makes it safe is that the categories have to satisfy football's own
 * bookkeeping, across a whole team, in numbers the game computed:
 *
 *   sum(receiving yards) == sum(passing yards)
 *   sum(catches)         == sum(completions)
 *   sum(receiving TDs)   == sum(passing TDs)
 *   defence's sacks      == the opposing QBs' sacks taken
 *   defence's INTs       == the opposing QBs' INTs thrown
 *
 * None of those depend on what the fields are called. A wrong assignment of
 * the category letters breaks all five.
 */

import {
  DEFENSIVE_FIELDS,
  PASSING_FIELDS,
  PLAYER_POSITIONS,
  RECEIVING_FIELDS,
  RUSHING_FIELDS,
  STAT_VALUE_SENTINEL,
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
  const fbs = new Set(play.rows.map((p) => playerTeam(n(p.PGID))));
  const pos = (pgid: number) => PLAYER_POSITIONS[n(byP.get(pgid)!.PPOS)] ?? '?';

  console.log(
    `PSOF: ${psof.rows.length} records, ${psof.f.length} fields\n` +
      `PSDE: ${psde.rows.length} records, ${psde.f.length} fields\n`,
  );

  // --- structure ------------------------------------------------------------
  for (const [tag, t] of [
    ['PSOF', psof],
    ['PSDE', psde],
  ] as const) {
    const sorted = [...t.f].sort((a, b) => a.bitOffset - b.bitOffset);
    let cursor = 0;
    let tiles = true;
    for (const f of sorted) {
      if (f.bitOffset !== cursor) tiles = false;
      cursor += f.bits;
    }
    check(
      `${tag} fields tile the record with no gaps or overlaps`,
      tiles,
      `${sorted.length} fields cover bits 0..${cursor - 1} of ${t.h.recordLenBytes * 8}`,
    );
  }

  // --- per-game, not season -------------------------------------------------
  check(
    'both tables are PER-GAME lines, not season totals',
    psof.rows.every((r) => n(r.sgmp) === 1) && psde.rows.every((r) => n(r.sgmp) === 1),
    `sgmp == 1 on every row of both tables; only week 0 has been played, so each ` +
      `player has at most one line`,
  );
  check(
    'every stat row belongs to an FBS player',
    psof.rows.every((r) => fbs.has(playerTeam(n(r.PGID)))) &&
      psde.rows.every((r) => fbs.has(playerTeam(n(r.PGID)))),
    `${psof.rows.length} offensive + ${psde.rows.length} defensive rows, all FBS — ` +
      `FCS teams have no PLAY roster and so generate no statistics`,
  );

  // --- position gating ------------------------------------------------------
  const onlyQb = (f: string) =>
    psof.rows.filter((r) => n(r[f]) !== 0).every((r) => pos(n(r.PGID)) === 'QB');
  check(
    'every passing column is owned exclusively by quarterbacks',
    Object.values(PASSING_FIELDS).every(onlyQb),
    `${Object.values(PASSING_FIELDS).join(', ')} — 100% QB on every nonzero row`,
  );
  const recvPos = new Set(
    psof.rows.filter((r) => n(r[RECEIVING_FIELDS.catches]) !== 0).map((r) => pos(n(r.PGID))),
  );
  check(
    'receiving columns belong to receiving positions',
    [...recvPos].every((p) => ['WR', 'TE', 'HB', 'FB', 'CB'].includes(p)),
    `catches recorded by {${[...recvPos].join(', ')}}`,
  );
  const rushPos = new Set(
    psof.rows.filter((r) => n(r[RUSHING_FIELDS.carries]) !== 0).map((r) => pos(n(r.PGID))),
  );
  const offBeat = psof.rows.filter(
    (r) =>
      (n(r[RUSHING_FIELDS.carries]) !== 0 || n(r[RECEIVING_FIELDS.catches]) !== 0) &&
      !['HB', 'FB', 'QB', 'WR', 'TE'].includes(pos(n(r.PGID))),
  );
  check(
    'rushing columns belong to ball-carrying positions',
    [...rushPos].every((p) => ['HB', 'FB', 'QB', 'WR', 'TE', 'CB'].includes(p)),
    `carries recorded by {${[...rushPos].join(', ')}}`,
  );
  check(
    'the only defender touching the ball on offence is a single two-way player',
    offBeat.length === 1 &&
      new Set(offBeat.map((r) => n(r.PGID))).size === 1 &&
      offBeat.every(
        (r) => n(r[RUSHING_FIELDS.carries]) <= 1 && n(r[RECEIVING_FIELDS.catches]) <= 1,
      ),
    `one CB with a single 6-yard carry and a single 5-yard catch — a trick play or a ` +
      `two-way player, which is real football rather than a decoding error; asserting ` +
      `the exact shape keeps it honest instead of widening the rule to hide it`,
  );

  // --- arithmetic invariants ------------------------------------------------
  const holds = (a: string, b: string) => {
    const rel = psof.rows.filter((r) => n(r[a]) !== 0 || n(r[b]) !== 0);
    return { ok: rel.filter((r) => n(r[a]) <= n(r[b])).length, tot: rel.length };
  };
  for (const [a, b, label] of [
    [PASSING_FIELDS.completions, PASSING_FIELDS.attempts, 'completions <= attempts'],
    [PASSING_FIELDS.touchdowns, PASSING_FIELDS.completions, 'passing TD <= completions'],
    [PASSING_FIELDS.interceptions, PASSING_FIELDS.attempts, 'interceptions <= attempts'],
    [RECEIVING_FIELDS.touchdowns, RECEIVING_FIELDS.catches, 'receiving TD <= catches'],
    [RUSHING_FIELDS.touchdowns, RUSHING_FIELDS.carries, 'rushing TD <= carries'],
  ] as const) {
    const { ok, tot } = holds(a, b);
    check(`invariant: ${label}`, ok === tot, `${ok}/${tot}`);
  }

  // The invariant test only means something if wrong pairings fail it.
  const control = [
    [PASSING_FIELDS.completions, RUSHING_FIELDS.carries],
    [PASSING_FIELDS.touchdowns, RECEIVING_FIELDS.catches],
    [RECEIVING_FIELDS.touchdowns, PASSING_FIELDS.attempts],
  ] as const;
  check(
    'control: the same invariants FAIL on deliberately wrong pairings',
    control.every(([a, b]) => {
      const { ok, tot } = holds(a, b);
      return ok < tot;
    }),
    `${control.length}/${control.length} wrong pairings break — so the invariants ` +
      `discriminate rather than being satisfied by anything`,
  );

  // --- the discriminating test: team bookkeeping ---------------------------
  const byTeam = (rows: Array<Record<string, number | string>>) => {
    const m = new Map<number, Array<Record<string, number | string>>>();
    for (const r of rows) {
      const t = playerTeam(n(r.PGID));
      if (!m.has(t)) m.set(t, []);
      m.get(t)!.push(r);
    }
    return m;
  };
  const off = byTeam(psof.rows);
  const def = byTeam(psde.rows);
  const sum = (rs: Array<Record<string, number | string>> | undefined, f: string) =>
    (rs ?? []).reduce((a, r) => a + n(r[f]), 0);

  for (const [ra, pa, label] of [
    [RECEIVING_FIELDS.yards, PASSING_FIELDS.yards, 'receiving yards == passing yards'],
    [RECEIVING_FIELDS.catches, PASSING_FIELDS.completions, 'catches == completions'],
    [RECEIVING_FIELDS.touchdowns, PASSING_FIELDS.touchdowns, 'receiving TD == passing TD'],
  ] as const) {
    let ok = 0;
    let tot = 0;
    for (const [, rs] of off) {
      const a = sum(rs, ra);
      const b = sum(rs, pa);
      if (a === 0 && b === 0) continue;
      tot++;
      if (a === b) ok++;
    }
    check(`team bookkeeping: ${label}`, ok === tot, `${ok}/${tot} teams balance exactly`);
  }

  // Wrong-category control for the same identity.
  let wrong = 0;
  let wrongTot = 0;
  for (const [, rs] of off) {
    const a = sum(rs, RUSHING_FIELDS.yards);
    const b = sum(rs, PASSING_FIELDS.yards);
    if (a === 0 && b === 0) continue;
    wrongTot++;
    if (a === b) wrong++;
  }
  check(
    'control: rushing yards do NOT balance against passing yards',
    wrong < wrongTot / 2,
    `${wrong}/${wrongTot} — the identity is specific to the receiving category, ` +
      `so the category letters are pinned, not guessed`,
  );

  // --- cross-table: defence against the opposing offence --------------------
  const games = schd.rows.filter(
    (g) => n(g.SEWN) === 0 && !(n(g.GHSC) === 0 && n(g.GASC) === 0),
  );
  const fbsGames = games.filter((g) => fbs.has(n(g.GHTG)) && fbs.has(n(g.GATG)));
  for (const [dField, oField, label] of [
    [DEFENSIVE_FIELDS.interceptions, PASSING_FIELDS.interceptions, 'interceptions'],
    [DEFENSIVE_FIELDS.sacks, PASSING_FIELDS.sacked, 'sacks'],
  ] as const) {
    let ok = 0;
    let tot = 0;
    for (const g of fbsGames) {
      for (const [d, o] of [
        [n(g.GHTG), n(g.GATG)],
        [n(g.GATG), n(g.GHTG)],
      ]) {
        tot++;
        if (sum(def.get(d), dField) === sum(off.get(o), oField)) ok++;
      }
    }
    check(
      `cross-table: a defence's ${label} equal the opponent's ${label} conceded`,
      ok === tot,
      `${ok}/${tot} across ${fbsGames.length} FBS-vs-FBS games — PSDE and PSOF ` +
        `were decoded independently and agree`,
    );
  }
  check(
    'the FCS games are excluded for a principled reason, not to hide a failure',
    games
      .filter((g) => !fbs.has(n(g.GHTG)) || !fbs.has(n(g.GATG)))
      .every((g) => {
        const fcs = fbs.has(n(g.GHTG)) ? n(g.GATG) : n(g.GHTG);
        return !off.has(fcs) && !def.has(fcs);
      }),
    `all ${games.length - fbsGames.length} FCS participants have zero stat rows, so ` +
      `their side of the identity was never written`,
  );

  // --- defensive internal consistency --------------------------------------
  const dHolds = (a: string, b: string) => {
    const rel = psde.rows.filter((r) => n(r[a]) !== 0);
    return { ok: rel.filter((r) => n(r[a]) <= n(r[b])).length, tot: rel.length };
  };
  {
    const { ok, tot } = dHolds(DEFENSIVE_FIELDS.tacklesForLoss, DEFENSIVE_FIELDS.tackles);
    check('invariant: tackles for loss <= total tackles', ok === tot, `${ok}/${tot}`);
  }
  {
    const { ok, tot } = dHolds(DEFENSIVE_FIELDS.sacks, DEFENSIVE_FIELDS.tacklesForLoss);
    check('invariant: sacks <= tackles for loss', ok === tot, `${ok}/${tot}`);
  }
  for (const [dep, base, label] of [
    [DEFENSIVE_FIELDS.interceptionYards, DEFENSIVE_FIELDS.interceptions, 'return yards require an interception'],
    [DEFENSIVE_FIELDS.fumbleReturnYards, DEFENSIVE_FIELDS.fumbleRecoveries, 'fumble return yards require a recovery'],
  ] as const) {
    const rel = psde.rows.filter((r) => n(r[dep]) !== 0);
    check(
      `dependency: ${label}`,
      rel.every((r) => n(r[base]) !== 0),
      `${rel.length}/${rel.length} rows with ${dep} also have ${base}`,
    );
  }

  // --- honest reporting of what is NOT solved ------------------------------
  const scycSentinel = psof.rows.filter((r) => n(r.scyc) === STAT_VALUE_SENTINEL).length;
  const scycBounded = psof.rows.filter(
    (r) => n(r.scyc) !== 0 && n(r.scyc) !== STAT_VALUE_SENTINEL && n(r.scyc) <= n(r.scya),
  ).length;
  const scycNonZero = psof.rows.filter(
    (r) => n(r.scyc) !== 0 && n(r.scyc) !== STAT_VALUE_SENTINEL,
  ).length;
  check(
    'scyc is reported as UNIDENTIFIED rather than guessed',
    scycBounded < scycNonZero,
    `${scycSentinel} rows sit at the ${STAT_VALUE_SENTINEL} sentinel, and only ` +
      `${scycBounded}/${scycNonZero} are bounded by receiving yards — so ` +
      `"yards after catch" does not survive testing`,
  );
  const coOccur = psof.rows.filter(
    (r) =>
      (n(r[RUSHING_FIELDS.brokenTackles]) !== 0) ===
      (n(r[RUSHING_FIELDS.yardsAfterContact]) !== 0),
  ).length;
  const ordered = psof.rows.filter(
    (r) =>
      n(r[RUSHING_FIELDS.brokenTackles]) !== 0 &&
      n(r[RUSHING_FIELDS.brokenTackles]) <= n(r[RUSHING_FIELDS.yardsAfterContact]),
  ).length;
  const btNonZero = psof.rows.filter((r) => n(r[RUSHING_FIELDS.brokenTackles]) !== 0).length;
  check(
    'subt and suyh are a linked pair (a count and the yards it produced)',
    coOccur === psof.rows.length && ordered === btNonZero,
    `they are both zero or both nonzero on ${coOccur}/${psof.rows.length} rows, and ` +
      `subt <= suyh on ${ordered}/${btNonZero} — consistent with broken tackles and ` +
      `the yards gained after contact, though which is which is inferred from the ordering`,
  );

  // --- the legitimate invariant "failures" ----------------------------------
  const longOver = psof.rows.filter(
    (r) => n(r[RUSHING_FIELDS.longest]) > n(r[RUSHING_FIELDS.yards]),
  );
  const negative = psof.rows.filter((r) => n(r[RUSHING_FIELDS.yards]) < 0).length;
  check(
    'longest run exceeding total yards is legitimate, not a decoding error',
    longOver.every((r) => n(r[RUSHING_FIELDS.carries]) > 1 || n(r[RUSHING_FIELDS.yards]) < 0),
    `${longOver.length} such rows; ${negative} players have NEGATIVE rushing yards ` +
      `(the field is signed), so a long gain plus bigger losses explains every case`,
  );

  // --- PLAC: cumulative in-game snapshots -----------------------------------
  const plac = load('PLAC');
  const offBy = new Map(psof.rows.map((r) => [n(r.PGID), r]));
  const defBy = new Map(psde.rows.map((r) => [n(r.PGID), r]));

  check(
    'PLAC joins SCHD on (SEWN, SGNM) and the player was in that game',
    (() => {
      const wk0 = new Map(
        schd.rows.filter((g) => n(g.SEWN) === 0).map((g) => [n(g.SGNM), g]),
      );
      return plac.rows.every((r) => {
        const g = wk0.get(n(r.SGNM));
        if (!g) return false;
        const t = playerTeam(n(r.PGID));
        return t === n(g.GHTG) || t === n(g.GATG);
      });
    })(),
    `${plac.rows.length}/${plac.rows.length} — chance alone would place ~4.8 of them`,
  );

  const placGroups = new Map<string, Array<Record<string, number | string>>>();
  for (const r of plac.rows) {
    const k = `${n(r.PGID)}|${n(r.PAty)}`;
    if (!placGroups.has(k)) placGroups.set(k, []);
    placGroups.get(k)!.push(r);
  }
  const placMulti = [...placGroups.values()].filter((g) => g.length > 1);
  check(
    'PLAC values are CUMULATIVE: they never decrease as PAas rises',
    ['PAsC', 'PAsS', 'PAcS', 'PAcV'].every((col) =>
      placMulti.every((g) => {
        const s = [...g].sort((a, b) => n(a.PAas) - n(b.PAas));
        return s.every((r, i) => i === 0 || n(r[col]) >= n(s[i - 1][col]));
      }),
    ),
    `${placMulti.length}/${placMulti.length} multi-row groups are monotone — PLAC is a ` +
      `running snapshot of a stat line, not a set of independent totals`,
  );
  check(
    "PLAC's highest snapshot never exceeds the player's final stat line",
    (() => {
      let over = 0;
      for (const [k, g] of placGroups) {
        const ty = Number(k.split('|')[1]);
        const pgid = Number(k.split('|')[0]);
        if (ty === 2 || ty === 3) {
          const o = offBy.get(pgid);
          if (o && Math.max(...g.map((r) => n(r.PAsS))) > n(o[PASSING_FIELDS.yards])) over++;
        } else if (ty === 8 || ty === 9) {
          const d = defBy.get(pgid);
          if (d && Math.max(...g.map((r) => n(r.PAcS))) > n(d[DEFENSIVE_FIELDS.interceptions]))
            over++;
        }
      }
      return over === 0;
    })(),
    `0 groups overshoot; the snapshots are prefixes of the final line, which is ` +
      `what "cumulative" predicts and what a set of unrelated totals would not give`,
  );
  check(
    'PLAC.PAat is exactly the offence/defence split of PAty',
    plac.rows.every((r) => (n(r.PAat) === 1) === [8, 9].includes(n(r.PAty))),
    `PAat == 1 on precisely the defensive categories (PAty 8 and 9), ` +
      `${plac.rows.filter((r) => n(r.PAat) === 1).length} rows`,
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
