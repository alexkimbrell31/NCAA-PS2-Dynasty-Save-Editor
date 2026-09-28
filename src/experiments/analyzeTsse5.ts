import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, playerTeam,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { f, rows: readRecords(buf, h, f) as any[] };
};
const pski = load('PSKI').rows, pskp = load('PSKP').rows, psde = load('PSDE').rows;
const psof = load('PSOF').rows, tsse = load('TSSE').rows, schd = load('SCHD').rows;
const team = load('TEAM').rows;
const nameOf = new Map(team.map(t => [t.TGID, t.TDNA]));
const s16 = (v: number) => (v >= 32768 ? v - 65536 : v);
const sum = (rows: any[], key: (r: any) => number) => {
  const m = new Map<number, number>();
  for (const r of rows) { const t = playerTeam(r.PGID); m.set(t, (m.get(t) ?? 0) + key(r)); }
  return m;
};
const g0 = (m: Map<number, number>, t: number) => m.get(t) ?? 0;
const played = schd.filter(g => g.SEWN === 0 && !(g.GHSC === 0 && g.GASC === 0));
const oppOf = new Map<number, number>();
for (const g of played) { oppOf.set(g.GHTG, g.GATG); oppOf.set(g.GATG, g.GHTG); }

const own: Record<string, Map<number, number>> = {
  fgMade: sum(pski, r => r.skfm), fgAtt: sum(pski, r => r.skfa),
  xpMade: sum(pski, r => r.skem), xpAtt: sum(pski, r => r.skea),
  punts: sum(pski, r => r.spat), kickoffs: sum(pski, r => r.sknk),
  passTD: sum(psof, r => r.satd), rushTD: sum(psof, r => r.sutd),
  defTD: sum(psde, r => r.ssdt), retTD: sum(pskp, r => r.srkt + r.srpt),
  sacks: sum(psde, r => r.slsk), tackles: sum(psde, r => r.sdta),
  tfl: sum(psde, r => r.sdtl), pd: sum(psde, r => r.sdpd),
  ff: sum(psde, r => r.slff), fr: sum(psde, r => r.slfr),
  intThrown: sum(psof, r => r.sain), sacked: sum(psof, r => r.sasa),
  fumbles: sum(psof, r => r.sufu ?? 0),
};
const hasStats = (t: number) => own.passTD.has(t) || own.fgMade.has(t);
const fbs = tsse.filter(r => hasStats(r.TGID));
const fbsVsFbs = fbs.filter(r => hasStats(oppOf.get(r.TGID)!));

const fields = (load('TSSE').f as any[]).map(f => f.name);
const nonConst = fields.filter(fn => new Set(tsse.map(r => r[fn])).size > 1);

console.log(`=== OWN-side matches (>=90%), ${fbs.length} rows ===`);
for (const fn of nonConst) {
  for (const [dn, dm] of Object.entries(own)) {
    let ok = 0; for (const r of fbs) if (s16(r[fn]) === g0(dm, r.TGID)) ok++;
    if (ok >= fbs.length * 0.9) console.log(`  ${fn.padEnd(5)} == ${dn}: ${ok}/${fbs.length}`);
  }
}

console.log(`\n=== OPPONENT-side matches (>=90%), ${fbsVsFbs.length} FBS-vs-FBS rows ===`);
for (const fn of nonConst) {
  for (const [dn, dm] of Object.entries(own)) {
    let ok = 0; for (const r of fbsVsFbs) if (s16(r[fn]) === g0(dm, oppOf.get(r.TGID)!)) ok++;
    if (ok >= fbsVsFbs.length * 0.9) console.log(`  ${fn.padEnd(5)} == OPP ${dn}: ${ok}/${fbsVsFbs.length}`);
  }
}

console.log('\n=== safety check: the 4 teams off by 2 ===');
const pf = new Map<number, number>();
for (const g of played) {
  pf.set(g.GHTG, (pf.get(g.GHTG) ?? 0) + g.GHSC);
  pf.set(g.GATG, (pf.get(g.GATG) ?? 0) + g.GASC);
}
const totalTD = (t: number) => g0(own.passTD, t) + g0(own.rushTD, t) + g0(own.defTD, t) + g0(own.retTD, t);
for (const r of fbs) {
  const t = r.TGID;
  const calc = 6 * totalTD(t) + g0(own.xpMade, t) + 3 * g0(own.fgMade, t) + 2 * r.ts2c;
  if (calc !== g0(pf, t)) console.log(`  ${nameOf.get(t)}: scored ${g0(pf, t)}, reconstructed ${calc}, diff ${g0(pf, t) - calc}`);
}

console.log('\n=== remaining unknown TSSE fields ===');
const solved = new Set(['tsop', 'tsor', 'tsoy', 'tsdp', 'tsdy', 'tsTy', 'tsty', 'tsPy', 'tspe',
  'tssk', 'tsDi', 'tspi', 'tsfr', 'TGID', 'tsPi', 'tspd', 'tsPt', 'tsrt', 'ts1d',
  'ts3c', 'ts3d', 'ts4c', 'ts4d', 'ts2a', 'ts2c']);
for (const fn of fields) {
  if (solved.has(fn)) continue;
  const vals = tsse.map(r => r[fn]);
  console.log(`  ${fn.padEnd(5)} nonzero ${vals.filter(v => v).length}/109 range ${Math.min(...vals)}..${Math.max(...vals)}  sample ${vals.slice(0, 10).join(',')}`);
}
