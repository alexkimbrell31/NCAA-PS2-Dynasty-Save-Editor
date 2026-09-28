import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return readRecords(buf, h, f) as any[];
};

const tsse = load('TSSE');
const schd = load('SCHD');
const team = load('TEAM');
const nameOf = new Map(team.map(t => [t.TGID, `${t.TDNA}`]));

const played = schd.filter(g => g.SEWN === 0 && !(g.GHSC === 0 && g.GASC === 0));
const byTgid = new Map(tsse.map(r => [r.TGID, r]));

// Do opponents' rows mirror each other?
let mirrorPass = 0, mirrorTotal = 0;
let arithPass = 0;
for (const g of played) {
  const a = byTgid.get(g.GATG), h = byTgid.get(g.GHTG);
  if (!a || !h) continue;
  mirrorTotal++;
  if (a.tsdp === h.tsop && a.tsdy === h.tsor && h.tsdp === a.tsop && h.tsdy === a.tsor) mirrorPass++;
}
for (const r of tsse) if (r.tsor + r.tsop === r.tsoy) arithPass++;

console.log(`FBS-vs-FBS week-0 games with both TSSE rows: ${mirrorTotal}`);
console.log(`opponent rows MIRROR (tsdp==opp.tsop && tsdy==opp.tsor): ${mirrorPass}/${mirrorTotal}`);
console.log(`tsor + tsop == tsoy: ${arithPass}/${tsse.length}`);

// CONTROL: mirror against a RANDOM non-opponent
let ctrl = 0;
for (let i = 0; i < tsse.length - 1; i++) {
  const a = tsse[i], b = tsse[i + 1];
  if (a.tsdp === b.tsop && a.tsdy === b.tsor) ctrl++;
}
console.log(`CONTROL (adjacent rows, not opponents): ${ctrl}/${tsse.length - 1}`);

// MCOV.CAN0 vs HEIS.CAN0 -- is CAN0 a TGID?
const mcov = load('MCOV')[0];
console.log(`\nMCOV: TGID=${mcov.TGID} (${nameOf.get(mcov.TGID)}), CAN0=${mcov.CAN0} (${nameOf.get(mcov.CAN0) ?? 'no such TGID'})`);
console.log(`  text: ${mcov.MCTX}`);
