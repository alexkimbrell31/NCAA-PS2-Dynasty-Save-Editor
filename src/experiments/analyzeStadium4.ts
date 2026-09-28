/**
 * STAD pass 4 -- confirm the hypotheses pass 3 raised.
 *
 *  - STYP is -1 for every known dome and 0 for outdoor stadiums.
 *  - SFTY may be the playing surface (Michigan/Carrier Dome = 4, Ohio Stadium
 *    and Beaver Stadium = 0; the first two had artificial turf in 2006, the
 *    latter two natural grass).
 *  - STts (65..99) looks like a temperature.
 *  - STwp and STfw are equal on 205/238 rows -- near-duplicates.
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

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
function load(name: string) {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  return readRecords(buf, h, parseFieldDescriptors(buf, h));
}
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);
const s = (v: number | string) => (typeof v === 'string' ? v : '');
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const stad = load('STAD');

// --- STYP as the indoor flag -----------------------------------------------
console.log('=== STYP: indoor / outdoor ===');
const indoor = stad.filter((r) => n(r.STYP) === -1);
const outdoor = stad.filter((r) => n(r.STYP) === 0);
console.log(`  STYP=-1: ${indoor.length} stadiums   STYP=0: ${outdoor.length}`);
console.log('  every STYP=-1 stadium:');
for (const r of indoor) {
  console.log(
    `    ${s(r.SNAM).padEnd(30)} ${s(r.SCIT).padEnd(16)} ${s(r.SSTA)}  ` +
      `snow=${n(r.SWSP)} rain=${n(r.SWRP)} wind=${n(r.SWWP)}`,
  );
}
console.log(
  `\n  indoor stadiums with ANY weather (snow/rain/wind): ` +
    `${indoor.filter((r) => n(r.SWSP) + n(r.SWRP) + n(r.SWWP) > 0).length}/${indoor.length}`,
);
console.log(
  `  outdoor stadiums with any weather: ` +
    `${outdoor.filter((r) => n(r.SWSP) + n(r.SWRP) + n(r.SWWP) > 0).length}/${outdoor.length}`,
);

// --- SFTY as playing surface -----------------------------------------------
console.log('\n=== SFTY: playing surface? ===');
const byFty = new Map<number, number>();
for (const r of stad) byFty.set(n(r.SFTY), (byFty.get(n(r.SFTY)) ?? 0) + 1);
console.log(
  '  counts: ' + [...byFty.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}:${c}`).join(' '),
);
// Ground truth: surfaces in use in 2006.
const GRASS = ['Ohio Stadium', 'Beaver Stadium', 'Ben Hill Griffin Stadium', 'Sanford Stadium', 'Jordan-Hare Stadium', 'Bryant-Denny Stadium', 'Neyland Stadium', 'Rose Bowl', 'Tiger Stadium'];
const TURF = ['Michigan Stadium', 'Carrier Dome', 'Nippert Stadium', 'Ford Field', 'Alamodome', 'Georgia Dome1'];
console.log('  known natural-grass stadiums:');
for (const nm of GRASS) {
  const r = stad.find((x) => s(x.SNAM) === nm);
  if (r) console.log(`    ${nm.padEnd(26)} SFTY=${n(r.SFTY)}`);
}
console.log('  known artificial-turf stadiums:');
for (const nm of TURF) {
  const r = stad.find((x) => s(x.SNAM) === nm);
  if (r) console.log(`    ${nm.padEnd(26)} SFTY=${n(r.SFTY)}`);
}
console.log(
  `\n  all indoor stadiums have SFTY != 0? ` +
    `${indoor.every((r) => n(r.SFTY) !== 0)} ` +
    `(domes cannot grow natural grass; values seen: ${[...new Set(indoor.map((r) => n(r.SFTY)))].sort().join(',')})`,
);

// --- STts as temperature ---------------------------------------------------
console.log('\n=== STts: temperature? ===');
const HOT = ['FL', 'TX', 'AZ', 'LA', 'MS', 'AL', 'GA', 'SC', 'HI', 'NM'];
const COLD = ['ME', 'NH', 'VT', 'MN', 'ND', 'SD', 'MT', 'WI', 'MI', 'NY', 'MA'];
const hot = stad.filter((r) => HOT.includes(s(r.SSTA)));
const cold = stad.filter((r) => COLD.includes(s(r.SSTA)));
console.log(`  mean STts, hot states:  ${mean(hot.map((r) => n(r.STts))).toFixed(1)} (${hot.length})`);
console.log(`  mean STts, cold states: ${mean(cold.map((r) => n(r.STts))).toFixed(1)} (${cold.length})`);
console.log(`  full range ${Math.min(...stad.map((r) => n(r.STts)))}..${Math.max(...stad.map((r) => n(r.STts)))}`);
console.log('  hottest:');
for (const r of [...stad].sort((a, b) => n(b.STts) - n(a.STts)).slice(0, 6)) {
  console.log(`    ${n(r.STts)}  ${s(r.SCIT)}, ${s(r.SSTA)}`);
}
console.log('  coldest:');
for (const r of [...stad].sort((a, b) => n(a.STts) - n(b.STts)).slice(0, 6)) {
  console.log(`    ${n(r.STts)}  ${s(r.SCIT)}, ${s(r.SSTA)}`);
}
// A second temperature field? STjt spans 0..80.
console.log(`\n  mean STjt, hot states:  ${mean(hot.map((r) => n(r.STjt))).toFixed(1)}`);
console.log(`  mean STjt, cold states: ${mean(cold.map((r) => n(r.STjt))).toFixed(1)}`);
console.log(`  mean STwp, hot states:  ${mean(hot.map((r) => n(r.STwp))).toFixed(1)}`);
console.log(`  mean STwp, cold states: ${mean(cold.map((r) => n(r.STwp))).toFixed(1)}`);
console.log(
  `  STts > STjt for ${stad.filter((r) => n(r.STts) > n(r.STjt)).length}/${stad.length} rows ` +
    `(consistent with a high/low pair)`,
);

// --- duplicate stadium names ----------------------------------------------
console.log('\n=== Duplicate SNAM values ===');
const nameCount = new Map<string, number>();
for (const r of stad) nameCount.set(s(r.SNAM), (nameCount.get(s(r.SNAM)) ?? 0) + 1);
const dups = [...nameCount.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
console.log(`  ${dups.length} names are used more than once:`);
for (const [nm, c] of dups.slice(0, 12)) console.log(`    ${String(c)}x  "${nm}"`);
console.log(
  '  "Memorial Stadium" rows: ' +
    stad.filter((r) => s(r.SNAM) === 'Memorial Stadium').map((r) => s(r.TDNA)).join(', '),
);
