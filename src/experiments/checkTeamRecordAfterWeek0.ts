/**
 * Week 0 has been played, so TEAM's season counters should no longer be zero.
 * Earlier work recorded them as "all zero, fresh dynasty". Check that claim.
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

const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (t: string) => {
  const h = parseTableHeader(buf, findTable(toc, t).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, rows: readRecords(buf, h, f) };
};

const team = load('TEAM');
const schd = load('SCHD');
const tn = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));

// Actual week-0 results.
const wins = new Map<number, number>();
const losses = new Map<number, number>();
for (const g of schd.rows) {
  if (n(g.SEWN) !== 0) continue;
  const h = n(g.GHSC);
  const a = n(g.GASC);
  if (h === 0 && a === 0) continue;
  const [w, l] = h > a ? [n(g.GHTG), n(g.GATG)] : [n(g.GATG), n(g.GHTG)];
  wins.set(w, (wins.get(w) ?? 0) + 1);
  losses.set(l, (losses.get(l) ?? 0) + 1);
}
console.log(`week 0 produced ${[...wins.values()].reduce((a, b) => a + b, 0)} winners`);

// Which TEAM fields reproduce that?
const allZero: string[] = [];
const hits: string[] = [];
for (const f of team.f) {
  const vals = team.rows.map((r) => n(r[f.name]));
  if (vals.every((v) => v === 0)) {
    allZero.push(f.name);
    continue;
  }
  const w = team.rows.filter((r) => n(r[f.name]) === (wins.get(n(r.TGID)) ?? 0)).length;
  const l = team.rows.filter((r) => n(r[f.name]) === (losses.get(n(r.TGID)) ?? 0)).length;
  if (w >= team.rows.length - 3) hits.push(`${f.name} == week-0 WINS on ${w}/${team.rows.length}`);
  if (l >= team.rows.length - 3) hits.push(`${f.name} == week-0 LOSSES on ${l}/${team.rows.length}`);
}
console.log(`\nTEAM fields that reproduce the week-0 record:`);
for (const h of hits) console.log(`  ${h}`);
if (!hits.length) console.log('  (none)');

console.log(`\nTEAM fields still entirely zero (${allZero.length}): ${allZero.join(' ')}`);

// Sample a few teams we know the result for.
console.log('\nSpot check:');
const interesting = [...wins.keys()].slice(0, 5);
for (const tg of interesting) {
  const r = team.rows.find((x) => n(x.TGID) === tg)!;
  const nonZero = team.f
    .map((f) => f.name)
    .filter((k) => n(r[k]) !== 0 && /^T/.test(k))
    .slice(0, 14);
  console.log(
    `  ${(tn.get(tg) ?? '?').padEnd(18)} won ${wins.get(tg)}  ` +
      nonZero.map((k) => `${k}=${n(r[k])}`).join(' '),
  );
}
