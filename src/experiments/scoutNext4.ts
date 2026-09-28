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
const nameOf = new Map(team.map(t => [t.TGID, t.TDNA]));

const played = schd.filter(g => g.SEWN === 0 && !(g.GHSC === 0 && g.GASC === 0));
const byTgid = new Map(tsse.map(r => [r.TGID, r]));

// Real opponent map
const opp = new Map<number, number>();
for (const g of played) { opp.set(g.GATG, g.GHTG); opp.set(g.GHTG, g.GATG); }

const mirrors = (a: any, b: any) => a.tsdp === b.tsop && a.tsdy === b.tsor;

// TRUE pairings
let real = 0, realTot = 0;
for (const g of played) {
  const a = byTgid.get(g.GATG), h = byTgid.get(g.GHTG);
  if (!a || !h) continue;
  realTot++;
  if (mirrors(a, h) && mirrors(h, a)) real++;
  else console.log(`  MISMATCH: ${nameOf.get(g.GATG)} @ ${nameOf.get(g.GHTG)}`);
}
console.log(`TRUE opponent pairs mirror: ${real}/${realTot}`);

// PROPER CONTROL: every NON-opponent pair
let ctrl = 0, ctrlTot = 0;
for (let i = 0; i < tsse.length; i++) {
  for (let j = 0; j < tsse.length; j++) {
    if (i === j) continue;
    if (opp.get(tsse[i].TGID) === tsse[j].TGID) continue; // skip real opponents
    ctrlTot++;
    if (mirrors(tsse[i], tsse[j]) && mirrors(tsse[j], tsse[i])) ctrl++;
  }
}
console.log(`CONTROL, all NON-opponent pairs: ${ctrl}/${ctrlTot}`);

// the tsor+tsop==tsoy exception
for (const r of tsse) {
  if (r.tsor + r.tsop !== r.tsoy) {
    console.log(`arith exception: ${nameOf.get(r.TGID)} rush=${r.tsor} pass=${r.tsop} total=${r.tsoy}`);
  }
}
