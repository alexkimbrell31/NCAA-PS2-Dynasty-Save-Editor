/** Check the capacity range across FBS and FCS. */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, playerTeam, readRecords, readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);
const str = (v: number | string) => (typeof v === 'string' ? v : '');

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (n: string) => {
  const e = findTable(toc, n);
  const h = parseTableHeader(buf, e.realOffset);
  return readRecords(buf, h, parseFieldDescriptors(buf, h));
};

const team = load('TEAM');
const play = load('PLAY');
const rostered = new Set(play.map((p) => playerTeam(num(p.PGID))));
const fbs = team.filter((r) => rostered.has(num(r.TGID)));
const fcs = team.filter((r) => !rostered.has(num(r.TGID)));

console.log('Smallest FBS stadiums:');
for (const r of [...fbs].sort((a, b) => num(a.TMAA) - num(b.TMAA)).slice(0, 10)) {
  console.log(`  ${str(r.TDNA).padEnd(20)} ${String(num(r.TMAA)).padStart(8)}  TMIA=${num(r.TMIA)}`);
}
console.log('\nSmallest FCS:');
for (const r of [...fcs].sort((a, b) => num(a.TMAA) - num(b.TMAA)).slice(0, 5)) {
  console.log(`  ${str(r.TDNA).padEnd(20)} ${String(num(r.TMAA)).padStart(8)}`);
}
console.log(`\nFCS with TMAA=0: ${fcs.filter((r) => num(r.TMAA) === 0).length} of ${fcs.length}`);
console.log(`FBS with TMAA=0: ${fbs.filter((r) => num(r.TMAA) === 0).length} of ${fbs.length}`);
