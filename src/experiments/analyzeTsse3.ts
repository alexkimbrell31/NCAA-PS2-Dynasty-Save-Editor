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
const passY = sum(psof, r => s16(r.saya)), rushY = sum(psof, r => s16(r.suya));
const hasStats = (t: number) => passY.has(t);
const g0 = (m: Map<number, number>, t: number) => m.get(t) ?? 0;
const oppOf = new Map<number, number>();
for (const g of played) { oppOf.set(g.GHTG, g.GATG); oppOf.set(g.GATG, g.GHTG); }

const fbs = tsse.filter(r => hasStats(r.TGID));
// teams whose OPPONENT also has stat rows
const fbsVsFbs = fbs.filter(r => hasStats(oppOf.get(r.TGID)!));
console.log(`rows: ${fbs.length}, of which opponent also has stats: ${fbsVsFbs.length}\n`);

const check = (label: string, set: any[], f: (r: any) => [number, number]) => {
  let ok = 0; const bad: string[] = [];
  for (const r of set) { const [a, b] = f(r); if (a === b) ok++; else if (bad.length < 3) bad.push(`${nameOf.get(r.TGID)} ${a}!=${b}`); }
  console.log(`${ok === set.length ? 'PASS' : '    '} ${label}: ${ok}/${set.length}${bad.length ? '  eg ' + bad.join('; ') : ''}`);
};

console.log('--- defense allowed, restricted to FBS-vs-FBS (the L16 move) ---');
check('tsdp == opp pass yards', fbsVsFbs, r => [s16(r.tsdp), g0(passY, oppOf.get(r.TGID)!)]);
check('tsdy == opp rush yards', fbsVsFbs, r => [s16(r.tsdy), g0(rushY, oppOf.get(r.TGID)!)]);
check('tsor+tsop == tsoy', fbs, r => [s16(r.tsor) + s16(r.tsop), s16(r.tsoy)]);
check('tsdp+tsdy == tsdefTotal? (search)', fbsVsFbs, r => [0, 0]);

console.log('\n--- is there a field == opp TOTAL offense? ---');
for (const fn of T.f.map((f: any) => f.name)) {
  let ok = 0;
  for (const r of fbsVsFbs) {
    const o = oppOf.get(r.TGID)!;
    if (s16(r[fn]) === g0(passY, o) + g0(rushY, o)) ok++;
  }
  if (ok >= fbsVsFbs.length * 0.9) console.log(`  ${fn} == opp total offense: ${ok}/${fbsVsFbs.length}`);
}

console.log('\n--- tsty: what is it? ---');
const samples = fbs.slice(0, 12);
for (const r of samples) {
  console.log(`  ${String(nameOf.get(r.TGID)).padEnd(22)} tsty=${String(r.tsty).padStart(5)} tsoy=${String(s16(r.tsoy)).padStart(5)} tsTy=${String(s16(r.tsTy)).padStart(5)} tsdp=${String(s16(r.tsdp)).padStart(4)} tsdy=${String(s16(r.tsdy)).padStart(4)} sum(def)=${s16(r.tsdp)+s16(r.tsdy)}`);
}
check('tsty == tsdp + tsdy (yards ALLOWED)', fbs, r => [r.tsty, s16(r.tsdp) + s16(r.tsdy)]);

console.log('\n--- PSKI field shapes (to decode kicking) ---');
const kf = load('PSKI').f.map((f: any) => f.name);
for (const fn of kf) {
  const vals = pski.map(r => r[fn]);
  const nz = vals.filter(v => v !== 0).length;
  console.log(`  ${fn.padEnd(6)} nonzero ${String(nz).padStart(4)}/${vals.length}  max ${Math.max(...vals)}`);
}
