/**
 * TSSE -- team season stats. Cross-check every field against summed PSOF/PSDE
 * per-game lines and against SCHD, with CONTROLS.
 */
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

const tsse = load('TSSE').rows;
const psof = load('PSOF').rows;
const psde = load('PSDE').rows;
const schd = load('SCHD').rows;
const team = load('TEAM').rows;
const nameOf = new Map(team.map(t => [t.TGID, t.TDNA]));

// signed 16-bit helper: TSSE yardage fields are unsigned in the descriptor
const s16 = (v: number) => (v >= 32768 ? v - 65536 : v);

const played = schd.filter(g => g.SEWN === 0 && !(g.GHSC === 0 && g.GASC === 0));

// --- Build per-team sums from PSOF / PSDE ---
const off = new Map<number, any>();
const get = (m: Map<number, any>, t: number) => {
  if (!m.has(t)) m.set(t, {});
  return m.get(t);
};
const add = (o: any, k: string, v: number) => { o[k] = (o[k] ?? 0) + v; };

for (const r of psof) {
  const t = playerTeam(r.PGID);
  const o = get(off, t);
  add(o, 'passYds', s16(r.saya)); add(o, 'passAtt', r.saat); add(o, 'comp', r.sacm);
  add(o, 'passTD', r.satd); add(o, 'int', r.sain); add(o, 'sacked', r.sasa);
  add(o, 'rushYds', s16(r.suya)); add(o, 'rushAtt', r.suat); add(o, 'rushTD', r.sutd);
  add(o, 'recTD', r.sctd); add(o, 'fum', r.sufu ?? 0);
}
const def = new Map<number, any>();
for (const r of psde) {
  const t = playerTeam(r.PGID);
  const o = get(def, t);
  add(o, 'sacks', r.slsk); add(o, 'int', r.ssin); add(o, 'ff', r.slff); add(o, 'fr', r.slfr);
}

// --- Points for/against from SCHD ---
const pf = new Map<number, number>(), pa = new Map<number, number>();
for (const g of played) {
  pf.set(g.GHTG, (pf.get(g.GHTG) ?? 0) + g.GHSC);
  pa.set(g.GHTG, (pa.get(g.GHTG) ?? 0) + g.GASC);
  pf.set(g.GATG, (pf.get(g.GATG) ?? 0) + g.GASC);
  pa.set(g.GATG, (pa.get(g.GATG) ?? 0) + g.GHSC);
}

// FBS teams only (those with stat rows)
const fbs = tsse.filter(r => off.has(r.TGID));
console.log(`TSSE rows: ${tsse.length}, with PSOF stat rows: ${fbs.length}\n`);

type Test = { label: string; f: (r: any) => [number, number] };
const tests: Test[] = [
  { label: 'tsop == sum pass yards', f: r => [s16(r.tsop), off.get(r.TGID).passYds] },
  { label: 'tsor == sum rush yards', f: r => [s16(r.tsor), off.get(r.TGID).rushYds] },
  { label: 'tsoy == total offense',  f: r => [s16(r.tsoy), off.get(r.TGID).passYds + off.get(r.TGID).rushYds] },
  { label: 'tsPy == points for',     f: r => [r.tsPy, pf.get(r.TGID) ?? -1] },
  { label: 'tssk == sacks BY def',   f: r => [r.tssk, def.get(r.TGID)?.sacks ?? -1] },
  { label: 'tsDi == INT by def',     f: r => [r.tsDi, def.get(r.TGID)?.int ?? -1] },
  { label: 'tsPi == INT thrown',     f: r => [r.tsPi, off.get(r.TGID).int] },
  { label: 'tspi == INT thrown',     f: r => [r.tspi, off.get(r.TGID).int] },
  { label: 'tsfr == fum recovered',  f: r => [r.tsfr, def.get(r.TGID)?.fr ?? -1] },
  { label: 'tsTy == pass+rush+?',    f: r => [s16(r.tsTy), off.get(r.TGID).passYds + off.get(r.TGID).rushYds] },
];

for (const t of tests) {
  let ok = 0;
  for (const r of fbs) { const [a, b] = t.f(r); if (a === b) ok++; }
  console.log(`${ok === fbs.length ? 'PASS' : '    '} ${t.label}: ${ok}/${fbs.length}`);
}

// CONTROL: shuffle the team association by one
console.log('\n--- CONTROLS (team shifted by one) ---');
for (const t of tests.slice(0, 5)) {
  let ok = 0;
  for (let i = 0; i < fbs.length; i++) {
    const r = { ...fbs[i], TGID: fbs[(i + 1) % fbs.length].TGID };
    if (!off.has(r.TGID)) continue;
    const [a, b] = t.f(r); if (a === b) ok++;
  }
  console.log(`  ${t.label}: ${ok}/${fbs.length}`);
}

// Points against: is it stored at all? scan every field for a match
console.log('\n--- which field == points AGAINST? ---');
const fieldNames = load('TSSE').f.map((f: any) => f.name);
for (const fn of fieldNames) {
  let ok = 0;
  for (const r of fbs) if (r[fn] === (pa.get(r.TGID) ?? -1)) ok++;
  if (ok > fbs.length * 0.5) console.log(`  ${fn}: ${ok}/${fbs.length}`);
}
console.log('\n--- which field == points FOR? ---');
for (const fn of fieldNames) {
  let ok = 0;
  for (const r of fbs) if (r[fn] === (pf.get(r.TGID) ?? -1)) ok++;
  if (ok > fbs.length * 0.5) console.log(`  ${fn}: ${ok}/${fbs.length}`);
}

// games played
console.log('\n--- games played per team (should be 1, week 0) ---');
const gp = new Map<number, number>();
for (const g of played) { gp.set(g.GHTG, (gp.get(g.GHTG) ?? 0) + 1); gp.set(g.GATG, (gp.get(g.GATG) ?? 0) + 1); }
console.log('  distinct game counts:', [...new Set([...gp.values()])].join(','));

// constant fields
console.log('\n--- constant fields ---');
for (const fn of fieldNames) {
  const vals = new Set(tsse.map(r => r[fn]));
  if (vals.size === 1) console.log(`  ${fn} = ${[...vals][0]}`);
}
