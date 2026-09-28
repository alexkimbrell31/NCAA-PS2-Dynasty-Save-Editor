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

const derived: Record<string, Map<number, number>> = {
  fgMade: sum(pski, r => r.skfm), fgAtt: sum(pski, r => r.skfa),
  xpMade: sum(pski, r => r.skem), xpAtt: sum(pski, r => r.skea),
  punts: sum(pski, r => r.spat), kickoffs: sum(pski, r => r.sknk),
  passTD: sum(psof, r => r.satd), rushTD: sum(psof, r => r.sutd),
  recTD: sum(psof, r => r.sctd), defTD: sum(psde, r => r.ssdt),
  retTD: sum(pskp, r => r.srkt + r.srpt),
  ff: sum(psde, r => r.slff), fr: sum(psde, r => r.slfr),
  sacks: sum(psde, r => r.slsk), tfl: sum(psde, r => r.sdtl),
  tackles: sum(psde, r => r.sdta), pd: sum(psde, r => r.sdpd),
  fum: sum(psof, r => r.sufu ?? 0),
};
const pf = new Map<number, number>();
const played = schd.filter(g => g.SEWN === 0 && !(g.GHSC === 0 && g.GASC === 0));
for (const g of played) {
  pf.set(g.GHTG, (pf.get(g.GHTG) ?? 0) + g.GHSC);
  pf.set(g.GATG, (pf.get(g.GATG) ?? 0) + g.GASC);
}
derived.pointsFor = pf;
derived.totalTD = new Map([...pf.keys()].map(t =>
  [t, g0(derived.passTD, t) + g0(derived.rushTD, t) + g0(derived.defTD, t) + g0(derived.retTD, t)]));
derived.offTD = new Map([...pf.keys()].map(t => [t, g0(derived.passTD, t) + g0(derived.rushTD, t)]));

const fbs = tsse.filter(r => derived.fgMade.has(r.TGID) || derived.passTD.has(r.TGID));
console.log(`matching ${fbs.length} rows\n`);

const fields = (load('TSSE').f as any[]).map(f => f.name);
for (const fn of fields) {
  const hits: string[] = [];
  for (const [dn, dm] of Object.entries(derived)) {
    let ok = 0;
    for (const r of fbs) if (s16(r[fn]) === g0(dm, r.TGID)) ok++;
    if (ok >= fbs.length * 0.95) hits.push(`${dn} ${ok}/${fbs.length}`);
  }
  if (hits.length) console.log(`  ${fn.padEnd(5)} == ${hits.join(' | ')}`);
}

console.log('\n--- points reconstruction: does pointsFor == 6*TD + xp + 3*fg + 2*2pt? ---');
let ok = 0;
for (const r of fbs) {
  const t = r.TGID;
  const calc = 6 * g0(derived.totalTD, t) + g0(derived.xpMade, t) + 3 * g0(derived.fgMade, t) + 2 * r.ts2c;
  if (calc === g0(pf, t)) ok++;
}
console.log(`  ${ok}/${fbs.length}`);

console.log('\n--- with safeties allowed (diff should be even, small) ---');
const diffs = new Map<number, number>();
for (const r of fbs) {
  const t = r.TGID;
  const calc = 6 * g0(derived.totalTD, t) + g0(derived.xpMade, t) + 3 * g0(derived.fgMade, t) + 2 * r.ts2c;
  const d = g0(pf, t) - calc;
  diffs.set(d, (diffs.get(d) ?? 0) + 1);
}
console.log('  diff histogram:', [...diffs.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}:${n}`).join(' '));
