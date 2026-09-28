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
const T = load('TSSE'); const tsse = T.rows;
const psof = load('PSOF').rows, psde = load('PSDE').rows;
const pskp = load('PSKP').rows, pski = load('PSKI').rows;
const schd = load('SCHD').rows, team = load('TEAM').rows;
const nameOf = new Map(team.map(t => [t.TGID, t.TDNA]));
const s16 = (v: number) => (v >= 32768 ? v - 65536 : v);
const played = schd.filter(g => g.SEWN === 0 && !(g.GHSC === 0 && g.GASC === 0));

const sum = (rows: any[], key: (r: any) => number) => {
  const m = new Map<number, number>();
  for (const r of rows) { const t = playerTeam(r.PGID); m.set(t, (m.get(t) ?? 0) + key(r)); }
  return m;
};
const passY = sum(psof, r => s16(r.saya));
const rushY = sum(psof, r => s16(r.suya));
const kickRetY = sum(pskp, r => r.srky);
const puntRetY = sum(pskp, r => r.srpy);
const intRetY = sum(psde, r => r.ssiy);
const fumRetY = sum(psde, r => r.slfy);
const puntY = sum(pski, r => r.spya);
const punts = sum(pski, r => r.spat);
const fgm = sum(pski, r => r.skem);
const fga = sum(pski, r => r.skea);

const pf = new Map<number, number>(), pa = new Map<number, number>();
for (const g of played) {
  pf.set(g.GHTG, (pf.get(g.GHTG) ?? 0) + g.GHSC); pa.set(g.GHTG, (pa.get(g.GHTG) ?? 0) + g.GASC);
  pf.set(g.GATG, (pf.get(g.GATG) ?? 0) + g.GASC); pa.set(g.GATG, (pa.get(g.GATG) ?? 0) + g.GHSC);
}
const fbs = tsse.filter(r => passY.has(r.TGID));
const g0 = (m: Map<number, number>, t: number) => m.get(t) ?? 0;

const check = (label: string, f: (r: any) => [number, number]) => {
  let ok = 0; const bad: string[] = [];
  for (const r of fbs) { const [a, b] = f(r); if (a === b) ok++; else if (bad.length < 3) bad.push(`${nameOf.get(r.TGID)} ${a} vs ${b}`); }
  console.log(`${ok === fbs.length ? 'PASS' : '    '} ${label}: ${ok}/${fbs.length}${bad.length ? '  eg ' + bad.join('; ') : ''}`);
};

console.log('--- penalties ---');
check('tsPy is penalty yards (4..15 per penalty)', r => [r.tspe === 0 || (r.tsPy >= r.tspe * 4 && r.tsPy <= r.tspe * 15) ? 1 : 0, 1]);
check('tsPy==0 iff tspe==0', r => [(r.tsPy === 0) === (r.tspe === 0) ? 1 : 0, 1]);

console.log('\n--- tsTy decomposition ---');
check('tsTy == tsoy + tsty', r => [s16(r.tsTy), s16(r.tsoy) + r.tsty]);
check('tsty == kick+punt+int+fum ret yds', r => [r.tsty,
  g0(kickRetY, r.TGID) + g0(puntRetY, r.TGID) + g0(intRetY, r.TGID) + g0(fumRetY, r.TGID)]);

console.log('\n--- defense allowed ---');
check('tsdp == opp pass yards', r => {
  const g = played.find(x => x.GHTG === r.TGID || x.GATG === r.TGID)!;
  const o = g.GHTG === r.TGID ? g.GATG : g.GHTG;
  return [s16(r.tsdp), g0(passY, o)];
});
check('tsdr? tsdy == opp rush yards', r => {
  const g = played.find(x => x.GHTG === r.TGID || x.GATG === r.TGID)!;
  const o = g.GHTG === r.TGID ? g.GATG : g.GHTG;
  return [s16(r.tsdy), g0(rushY, o)];
});

console.log('\n--- punting / kicking ---');
check('tspd == punts', r => [r.tspd, g0(punts, r.TGID)]);
check('tsga == FG made', r => [r.tsga, g0(fgm, r.TGID)]);
check('tsta == FG att', r => [r.tsta, g0(fga, r.TGID)]);
check('tssa == FG att', r => [r.tssa, g0(fga, r.TGID)]);
check('ts2a == FG att', r => [r.ts2a, g0(fga, r.TGID)]);

console.log('\n--- brute force: match every TSSE field against every derived quantity ---');
const derived: Record<string, Map<number, number>> = {
  passYds: passY, rushYds: rushY, kickRetYds: kickRetY, puntRetYds: puntRetY,
  intRetYds: intRetY, fumRetYds: fumRetY, puntYds: puntY, punts, fgMade: fgm, fgAtt: fga,
  pointsFor: pf, pointsAgainst: pa,
};
for (const fn of T.f.map((f: any) => f.name)) {
  for (const [dn, dm] of Object.entries(derived)) {
    let ok = 0;
    for (const r of fbs) if (s16(r[fn]) === g0(dm, r.TGID)) ok++;
    if (ok >= fbs.length * 0.9) console.log(`  ${fn} == ${dn}: ${ok}/${fbs.length}`);
  }
}
