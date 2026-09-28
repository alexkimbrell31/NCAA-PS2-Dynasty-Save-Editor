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
  ff: sum(psde, r => r.slff), fr: sum(psde, r => r.slfr),
  fumbles: sum(psof, r => r.sufu ?? 0), pd: sum(psde, r => r.sdpd),
  tfl: sum(psde, r => r.sdtl), kickRet: sum(pskp, r => r.srka),
  puntRet: sum(pskp, r => r.srpa),
};
own.totalTD = new Map([...own.passTD.keys()].map(t =>
  [t, g0(own.passTD, t) + g0(own.rushTD, t) + g0(own.defTD, t) + g0(own.retTD, t)]));
own.offTD = new Map([...own.passTD.keys()].map(t => [t, g0(own.passTD, t) + g0(own.rushTD, t)]));

const hasStats = (t: number) => own.passTD.has(t) || own.fgMade.has(t);
const fbs = tsse.filter(r => hasStats(r.TGID));
const fbsVsFbs = fbs.filter(r => hasStats(oppOf.get(r.TGID)!));
const targets = ['tsga', 'tsta', 'tsdf', 'tsof', 'tsdr', 'tsdt', 'tsot', 'tsoz'];

console.log('=== BEST matches for the 8 remaining fields (any rate) ===');
for (const fn of targets) {
  const scores: [string, number, number][] = [];
  for (const [dn, dm] of Object.entries(own)) {
    let a = 0; for (const r of fbs) if (r[fn] === g0(dm, r.TGID)) a++;
    scores.push([`own ${dn}`, a, fbs.length]);
    let b = 0; for (const r of fbsVsFbs) if (r[fn] === g0(dm, oppOf.get(r.TGID)!)) b++;
    scores.push([`OPP ${dn}`, b, fbsVsFbs.length]);
  }
  scores.sort((x, y) => y[1] / y[2] - x[1] / x[2]);
  const top = scores.slice(0, 3).map(([n, a, t]) => `${n} ${a}/${t}`).join('  |  ');
  console.log(`  ${fn.padEnd(5)} ${top}`);
}

console.log('\n=== structural relations among the 8 ===');
const rel = (l: string, f: (r: any) => boolean, set = fbs) => {
  let ok = 0; for (const r of set) if (f(r)) ok++;
  console.log(`${ok === set.length ? 'PASS' : '    '} ${l}: ${ok}/${set.length}`);
};
rel('tsga <= tsta', r => r.tsga <= r.tsta);
rel('tsdt <= tsot', r => r.tsdt <= r.tsot);
rel('tsdt + tsot relation to tsoz', r => r.tsoz >= 0);
rel('tsoz >= tsdt (RZ trips >= RZ TDs)', r => r.tsoz >= r.tsdt);
rel('tsoz >= tsot', r => r.tsoz >= r.tsot);
rel('tsdr >= tsdt', r => r.tsdr >= r.tsdt);
rel('tsof >= tsfl (fumbles >= lost)', r => r.tsof >= r.tsfl);
rel('tsdf >= 0 vs ff', r => true);

console.log('\n--- tsoz vs own total TD + FG (red-zone trips should exceed scores) ---');
rel('tsoz >= offTD', r => r.tsoz >= g0(own.offTD, r.TGID));
rel('tsoz >= fgMade', r => r.tsoz >= g0(own.fgMade, r.TGID));
rel('tsoz >= offTD+fgMade? ', r => r.tsoz >= g0(own.offTD, r.TGID) + g0(own.fgMade, r.TGID));

console.log('\n--- tsot/tsdt as OPPONENT red zone / TD allowed ---');
rel('tsot == OPP tsoz', r => {
  const o = tsse.find(x => x.TGID === oppOf.get(r.TGID));
  return !!o && r.tsot === o.tsoz;
}, fbsVsFbs);
rel('tsdt == OPP tsdr', r => {
  const o = tsse.find(x => x.TGID === oppOf.get(r.TGID));
  return !!o && r.tsdt === o.tsdr;
}, fbsVsFbs);
rel('tsdr == OPP tsdt', r => {
  const o = tsse.find(x => x.TGID === oppOf.get(r.TGID));
  return !!o && r.tsdr === o.tsdt;
}, fbsVsFbs);
rel('tsdf == OPP tsof', r => {
  const o = tsse.find(x => x.TGID === oppOf.get(r.TGID));
  return !!o && r.tsdf === o.tsof;
}, fbsVsFbs);
rel('tsga == OPP tsta', r => {
  const o = tsse.find(x => x.TGID === oppOf.get(r.TGID));
  return !!o && r.tsga === o.tsta;
}, fbsVsFbs);
rel('tsta == OPP tsga', r => {
  const o = tsse.find(x => x.TGID === oppOf.get(r.TGID));
  return !!o && r.tsta === o.tsga;
}, fbsVsFbs);
