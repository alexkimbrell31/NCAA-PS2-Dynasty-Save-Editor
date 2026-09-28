import { readSaveFile, parseToc, parseTableHeader, parseFieldDescriptors, readRecords, findTable } from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf);

function load(name: string) {
  const t = findTable(toc, name);
  if (!t) return null;
  const h = parseTableHeader(buf, t.offset);
  const f = parseFieldDescriptors(buf, t.offset, h);
  const r = readRecords(buf, t.offset, h, f);
  return { h, f, r };
}

for (const name of ['TSSE', 'PSKP', 'PSKI', 'MCOV', 'MOIN', 'POAG', 'MRCT']) {
  const t = load(name);
  if (!t) { console.log(`${name}: MISSING`); continue; }
  console.log(`\n=== ${name}  ${t.h.currentRecords}/${t.h.maxRecords} recs, ${t.f.length} fields, ${t.h.recLenBytes}B ===`);
  console.log('fields:', t.f.map(f => `${f.name}(${f.bits})`).join(' '));
  for (const rec of t.r.slice(0, 3)) {
    console.log('  ', JSON.stringify(rec).slice(0, 300));
  }
}

// The key question: does TSSE have one row per team-game of week 0?
const tsse = load('TSSE');
const schd = load('SCHD');
if (tsse && schd) {
  const played = schd.r.filter((g: any) => g.SEWN === 0 && !(g.GHSC === 0 && g.GASC === 0));
  const teamsPlayed = new Set<number>();
  for (const g of played) { teamsPlayed.add(g.GHTG); teamsPlayed.add(g.GATG); }
  console.log(`\nweek-0 played games: ${played.length}, distinct teams: ${teamsPlayed.size}`);
  console.log(`TSSE rows: ${tsse.r.length}`);
  const tgids = tsse.r.map((r: any) => r.TGID);
  console.log(`TSSE TGID distinct: ${new Set(tgids).size}`);
  const inPlayed = tgids.filter((t: number) => teamsPlayed.has(t)).length;
  console.log(`TSSE TGIDs that played week 0: ${inPlayed}/${tgids.length}`);
}
