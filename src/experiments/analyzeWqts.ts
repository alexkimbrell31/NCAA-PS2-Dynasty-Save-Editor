/**
 * WQTS looks like a quarter-by-quarter line score: 272 rows = 68 games x 4
 * quarters, with GHSC/GASC per quarter. If so, the quarters of a game must sum
 * to that game's final score in SCHD.
 *
 * This matters beyond WQTS: it would establish that week 0 has actually been
 * PLAYED, which contradicts the "fresh preseason dynasty" assumption that
 * earlier tables were read under.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

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
  const teamName = new Map(team.rows.map((t) => [num(t.TGID), String(t.TDNA)]));

  // Group WQTS by game.
  const byGame = new Map<number, Array<Record<string, number | string>>>();
  for (const r of wqts.rows) {
    const g = num(r.SGNM);
    if (!byGame.has(g)) byGame.set(g, []);
    byGame.get(g)!.push(r);
  }
  const sizes = new Map<number, number>();
  for (const g of byGame.values()) sizes.set(g.length, (sizes.get(g.length) ?? 0) + 1);
  console.log(
    `WQTS: ${wqts.rows.length} rows over ${byGame.size} games; ` +
      `rows-per-game ${[...sizes].map(([k, v]) => `${k}x:${v}`).join(' ')}`,
  );
  console.log(
    `quarters present: ${[...new Set(wqts.rows.map((r) => num(r.GQTR)))].sort().join(',')}`,
  );

  const wk0 = new Map(
    schd.rows.filter((g) => num(g.SEWN) === 0).map((g) => [num(g.SGNM), g]),
  );
  console.log(`SCHD week 0: ${wk0.size} games; WQTS covers ${byGame.size} of them`);

  // Which SCHD week-0 games have NO quarter data?
  const missing = [...wk0.keys()].filter((g) => !byGame.has(g));
  console.log(`\n${missing.length} week-0 game(s) have no WQTS rows:`);
  for (const g of missing) {
    const s = wk0.get(g)!;
    console.log(
      `  SGNM ${String(g).padStart(3)}  ` +
        `${(teamName.get(num(s.GATG)) ?? '?').padEnd(18)} at ` +
        `${(teamName.get(num(s.GHTG)) ?? '?').padEnd(18)}  ` +
        Object.entries(s)
          .filter(([k]) => /SC|GFHU|GFFU|GPLA/.test(k))
          .map(([k, v]) => `${k}=${v}`)
          .join(' '),
    );
  }

  // The decisive test: quarters sum to the final score.
  const scoreFields = schd.f.map((f) => f.name);
  console.log(`\nSCHD score-like fields: ${scoreFields.filter((n) => /SC/.test(n)).join(', ')}`);

  for (const [hf, af] of [
    ['GHSC', 'GASC'],
    ['GHSc', 'GASc'],
  ] as const) {
    if (!scoreFields.includes(hf)) continue;
    let ok = 0;
    let total = 0;
    const bad: string[] = [];
    for (const [g, qs] of byGame) {
      const s = wk0.get(g);
      if (!s) continue;
      total++;
      const h = qs.reduce((a, q) => a + num(q.GHSC), 0);
      const a = qs.reduce((x, q) => x + num(q.GASC), 0);
      if (h === num(s[hf]) && a === num(s[af])) ok++;
      else if (bad.length < 8) {
        bad.push(
          `SGNM ${g}: quarters ${h}-${a} vs SCHD ${num(s[hf])}-${num(s[af])}  ` +
            `${teamName.get(num(s.GATG))} at ${teamName.get(num(s.GHTG))}`,
        );
      }
    }
    console.log(`\nquarter sums == SCHD ${hf}/${af}: ${ok}/${total}`);
    for (const b of bad) console.log(`    ${b}`);
  }

  // Show a few full line scores.
  console.log('\nSample line scores:');
  for (const g of [...byGame.keys()].slice(0, 6)) {
    const qs = byGame.get(g)!.sort((a, b) => num(a.GQTR) - num(b.GQTR));
    const s = wk0.get(g);
    const h = qs.reduce((a, q) => a + num(q.GHSC), 0);
    const a = qs.reduce((x, q) => x + num(q.GASC), 0);
    console.log(
      `  ${(teamName.get(num(s!.GATG)) ?? '?').padEnd(18)} ` +
        `${qs.map((q) => String(num(q.GASC)).padStart(3)).join('')}  = ${String(a).padStart(3)}`,
    );
    console.log(
      `  ${(teamName.get(num(s!.GHTG)) ?? '?').padEnd(18)} ` +
        `${qs.map((q) => String(num(q.GHSC)).padStart(3)).join('')}  = ${String(h).padStart(3)}`,
    );
    console.log('');
  }
}

main();
