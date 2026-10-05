/**
 * Could we retrofit a 4-team playoff into SCHD/BOWL?
 * The postseason already has: conference championships, bowls, and a single
 * national championship game. A 4-team playoff needs 2 semifinals feeding a
 * final. Check what slack exists.
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, NO_TEAM,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, rows: readRecords(buf, h, f) as any[] };
};
const schd = load('SCHD'), bowl = load('BOWL'), stad = load('STAD'), conf = load('CONF');
const stadName = new Map(stad.rows.map(s => [s.SGID, `${s.SNAM}, ${s.SCIT}`]));

console.log('=== capacity ===');
console.log(`  SCHD ${schd.h.currentRecords}/${schd.h.maxRecords} rows  (${schd.h.maxRecords - schd.h.currentRecords} FREE)`);
console.log(`  BOWL ${bowl.h.currentRecords}/${bowl.h.maxRecords} rows  (${bowl.h.maxRecords - bowl.h.currentRecords} FREE)`);

console.log('\n=== postseason structure today ===');
const post = schd.rows.filter(g => g.SEWN >= 15);
const byWeek = new Map<number, any[]>();
for (const g of post) {
  if (!byWeek.has(g.SEWN)) byWeek.set(g.SEWN, []);
  byWeek.get(g.SEWN)!.push(g);
}
for (const [w, gs] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
  const wt = new Set(gs.map(g => g.SEWT));
  console.log(`  SEWN ${String(w).padStart(2)}  SEWT ${[...wt].join(',')}  ${gs.length} games  ` +
    `GDAT ${[...new Set(gs.map(g => g.GDAT))].join(',')}`);
}

console.log('\n=== the championship game row ===');
const title = bowl.rows.find(b => b.SEWN === 21);
console.log(`  BOWL: "${title.BNME}" BIDX ${title.BIDX} SEWN ${title.SEWN} SGNM ${title.SGNM}`);
console.log(`  date ${title.BMON}/${title.BDAY}, SGID ${title.SGID} (${title.SGID === 255 ? 'TBD' : stadName.get(title.SGID)})`);
console.log(`  tie-ins BCI1 ${title.BCI1} / BCI2 ${title.BCI2}, ranks BCR1 ${title.BCR1} / BCR2 ${title.BCR2}`);
const tg = schd.rows.find(g => g.SEWN === 21);
console.log(`  SCHD: SEWN ${tg.SEWN} SEWT ${tg.SEWT} SGNM ${tg.SGNM} GDAT ${tg.GDAT} GTOD ${tg.GTOD} ` +
  `teams ${tg.GATG}/${tg.GHTG} (NO_TEAM=${NO_TEAM})`);

console.log('\n=== field widths: is there room to express more weeks/games? ===');
for (const name of ['SEWN', 'SEWT', 'SGNM', 'GATG', 'GHTG']) {
  const f = schd.f.find((x: any) => x.name === name);
  console.log(`  SCHD.${name.padEnd(5)} ${f.bits} bits, max ${(1 << f.bits) - 1}`);
}
for (const name of ['SEWN', 'SGNM', 'BIDX', 'BCI1', 'BCR1']) {
  const f = bowl.f.find((x: any) => x.name === name);
  console.log(`  BOWL.${name.padEnd(5)} ${f.bits} bits, max ${(1 << f.bits) - 1}`);
}

console.log('\n=== which SEWT / SEWN values are UNUSED (free to repurpose)? ===');
const usedWN = new Set(schd.rows.map(g => g.SEWN));
const usedWT = new Set(schd.rows.map(g => g.SEWT));
const maxWN = (1 << schd.f.find((x: any) => x.name === 'SEWN').bits) - 1;
const maxWT = (1 << schd.f.find((x: any) => x.name === 'SEWT').bits) - 1;
console.log(`  SEWN used: ${[...usedWN].sort((a, b) => a - b).join(',')}`);
console.log(`  SEWN free: ${Array.from({ length: maxWN + 1 }, (_, i) => i).filter(i => !usedWN.has(i)).join(',')}`);
console.log(`  SEWT used: ${[...usedWT].sort((a, b) => a - b).join(',')}`);
console.log(`  SEWT free: ${Array.from({ length: maxWT + 1 }, (_, i) => i).filter(i => !usedWT.has(i)).join(',')}`);

console.log('\n=== the 34 TBD games (both teams NO_TEAM) ===');
const tbd = schd.rows.filter(g => g.GATG === NO_TEAM && g.GHTG === NO_TEAM);
console.log(`  ${tbd.length} rows, weeks ${[...new Set(tbd.map(g => g.SEWN))].sort((a, b) => a - b).join(',')}`);
console.log('  => the game FILLS these at season end. That machinery is what a playoff would need to hijack.');

console.log('\n=== BOWL rows available to repurpose (least prestigious bowls) ===');
bowl.rows.filter(b => b.SEWN === 18).slice(0, 8).forEach(b =>
  console.log(`  "${String(b.BNME).padEnd(28)}" SEWN ${b.SEWN} SGNM ${b.SGNM} ` +
    `tie-ins ${b.BCI1}/${b.BCI2} ranks ${b.BCR1}/${b.BCR2} ${b.BMON}/${b.BDAY}`));

console.log('\n=== dates: is there room after Jan 8? ===');
const dates = bowl.rows.map(b => ({ n: String(b.BNME), m: b.BMON, d: b.BDAY, w: b.SEWN }))
  .sort((a, b) => (a.m === b.m ? a.d - b.d : (a.m === 12 ? -1 : 1)));
console.log(`  latest: ${dates.slice(-4).map(x => `${x.n} ${x.m}/${x.d} (wk ${x.w})`).join(' | ')}`);
