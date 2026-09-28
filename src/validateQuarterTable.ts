/**
 * Validate WQTS -- the quarter-by-quarter line score.
 *
 * WQTS is small but it carries the single most consequential finding in the
 * project so far: week 0 has been PLAYED. Earlier tables were read under the
 * assumption of an untouched preseason dynasty, and that assumption was wrong.
 */

import {
  QUARTERS_PER_GAME,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
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
  const load = (tag: string) => {
    const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { h, f, rows: readRecords(buf, h, f) };
  };

  const wqts = load('WQTS');
  const schd = load('SCHD');
  const team = load('TEAM');
  const teamName = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));
  const rows = wqts.rows;

  console.log(`WQTS: ${rows.length} records, ${wqts.f.length} fields\n`);

  // --- structure ------------------------------------------------------------
  const sorted = [...wqts.f].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  let tiles = true;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) tiles = false;
    cursor += f.bits;
  }
  check(
    'fields tile the record with no gaps or overlaps',
    tiles,
    `${sorted.length} fields cover bits 0..${cursor - 1} of ${wqts.h.recordLenBytes * 8}`,
  );

  // --- four rows per game ---------------------------------------------------
  const byGame = new Map<number, Array<Record<string, number | string>>>();
  for (const r of rows) {
    const g = n(r.SGNM);
    if (!byGame.has(g)) byGame.set(g, []);
    byGame.get(g)!.push(r);
  }
  check(
    'every game has exactly four rows',
    [...byGame.values()].every((g) => g.length === QUARTERS_PER_GAME),
    `${byGame.size} games x ${QUARTERS_PER_GAME} quarters = ${rows.length} rows`,
  );
  check(
    'those four rows are quarters 1..4, each once',
    [...byGame.values()].every((g) => {
      const qs = g.map((r) => n(r.GQTR)).sort();
      return qs.join(',') === '1,2,3,4';
    }),
    `GQTR is ${wqts.f.find((f) => f.name === 'GQTR')?.bits} bits (room for OT), ` +
      `but only 1..4 occur — no game went to overtime`,
  );

  // --- the join -------------------------------------------------------------
  const wk0 = new Map(
    schd.rows.filter((g) => n(g.SEWN) === 0).map((g) => [n(g.SGNM), g]),
  );
  check(
    'every WQTS row carries SEWN 0 and joins a SCHD week-0 game',
    rows.every((r) => n(r.SEWN) === 0 && wk0.has(n(r.SGNM))),
    `${byGame.size} of SCHD's ${wk0.size} week-0 games have quarter data`,
  );

  // --- the decisive test ----------------------------------------------------
  // GHSC/GASC could be a running total rather than per-quarter points. Summing
  // discriminates: a running total would not sum to the final score.
  let summed = 0;
  let running = 0;
  for (const [g, qs] of byGame) {
    const s = wk0.get(g)!;
    const h = qs.reduce((a, q) => a + n(q.GHSC), 0);
    const a = qs.reduce((x, q) => x + n(q.GASC), 0);
    if (h === n(s.GHSC) && a === n(s.GASC)) summed++;
    const last = qs.slice().sort((x, y) => n(x.GQTR) - n(y.GQTR))[3];
    if (n(last.GHSC) === n(s.GHSC) && n(last.GASC) === n(s.GASC)) running++;
  }
  check(
    'quarter scores SUM to the final score in SCHD',
    summed === byGame.size,
    `${summed}/${byGame.size} — they are per-quarter points, not a running total`,
  );
  check(
    'the running-total reading is ruled out',
    running < byGame.size,
    `treating Q4 as the final score works on only ${running}/${byGame.size}`,
  );

  // --- scores are football scores -------------------------------------------
  const finals = [...byGame.values()].map((qs) => ({
    h: qs.reduce((a, q) => a + n(q.GHSC), 0),
    a: qs.reduce((x, q) => x + n(q.GASC), 0),
  }));
  check(
    'no game ended in a tie',
    finals.every((f) => f.h !== f.a),
    `college football has had overtime since 1996; ${finals.length}/${finals.length} games have a winner`,
  );
  const impossible = [1];
  const allQ = rows.flatMap((r) => [n(r.GHSC), n(r.GASC)]);
  check(
    'no quarter scored an impossible number of points',
    allQ.every((v) => !impossible.includes(v)),
    `${allQ.length} quarter scores, none equal to 1 (unscoreable in one quarter)`,
  );

  // --- the week-0 correction ------------------------------------------------
  const missing = [...wk0.keys()].filter((g) => !byGame.has(g));
  check(
    'exactly three week-0 games have not been played',
    missing.length === 3,
    missing
      .map(
        (g) =>
          `${teamName.get(n(wk0.get(g)!.GATG))} at ${teamName.get(n(wk0.get(g)!.GHTG))}`,
      )
      .join('; '),
  );
  check(
    'the unplayed games are exactly the ones with a zero score in SCHD',
    [...wk0.keys()].every(
      (g) =>
        byGame.has(g) === !(n(wk0.get(g)!.GHSC) === 0 && n(wk0.get(g)!.GASC) === 0),
    ),
    'a 0-0 final never occurs among the played games, so score==0 is a reliable ' +
      '"not played" signal',
  );
  const userGame = missing.filter(
    (g) => n(wk0.get(g)!.GFHU) === 1 || n(wk0.get(g)!.GFFU) === 1,
  );
  check(
    "one of the three unplayed games is the user's own",
    userGame.length === 1,
    `${teamName.get(n(wk0.get(userGame[0])!.GATG))} at ` +
      `${teamName.get(n(wk0.get(userGame[0])!.GHTG))} — the fixture PLGA caches rosters for`,
  );
  check(
    'the other two unplayed games fall later in the week than every played game',
    missing
      .filter((g) => !userGame.includes(g))
      .every((g) => {
        const d = n(wk0.get(g)!.GDAT);
        return [...byGame.keys()].every((p) => n(wk0.get(p)!.GDAT) <= d);
      }),
    'consistent with 2006: Kentucky-Louisville was the Sunday night game and ' +
      'Florida State-Miami the Labor Day Monday game',
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
