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
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, rows: readRecords(buf, h, f) };
};

for (const name of ['TSSE', 'PSKP', 'PSKI', 'MCOV', 'MOIN']) {
  const t = load(name);
  console.log(`\n=== ${name}  ${t.h.currentRecords}/${t.h.maxRecords} recs, ${t.f.length} fields, ${t.h.recLenBytes}B ===`);
  console.log('fields:', t.f.map((f: any) => `${f.name}(${f.bits})`).join(' '));
  for (const rec of t.rows.slice(0, 3)) console.log('  ', JSON.stringify(rec).slice(0, 400));
}

const tsse = load('TSSE');
const schd = load('SCHD');
const played = schd.rows.filter((g: any) => g.SEWN === 0 && !(g.GHSC === 0 && g.GASC === 0));
const teamsPlayed = new Set<number>();
for (const g of played as any[]) { teamsPlayed.add(g.GHTG); teamsPlayed.add(g.GATG); }
console.log(`\nweek-0 played games: ${played.length}, distinct teams: ${teamsPlayed.size}`);
console.log(`TSSE rows: ${tsse.rows.length}`);
const tgids = (tsse.rows as any[]).map(r => r.TGID);
console.log(`TSSE TGID distinct: ${new Set(tgids).size}`);
console.log(`TSSE TGIDs that played week 0: ${tgids.filter(t => teamsPlayed.has(t)).length}/${tgids.length}`);
