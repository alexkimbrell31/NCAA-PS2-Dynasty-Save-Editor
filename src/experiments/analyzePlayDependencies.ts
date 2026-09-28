/**
 * If we bulk-edit PLAY, what else has to change?
 * Find every table that references a player, duplicates player data, or
 * stores something DERIVED from the roster.
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, playerTeam, RATING_FIELDS,
  PLAYER_POSITIONS, ratingToDisplay,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, rows: readRecords(buf, h, f) as any[] };
};

const play = load('PLAY');
const pgids = new Set(play.rows.map(r => r.PGID));

console.log('=== 1. tables containing a PGID column ===');
for (const t of toc) {
  try {
    const h = parseTableHeader(buf, t.realOffset);
    if (h.currentRecords === 0) continue;
    const f = parseFieldDescriptors(buf, h);
    if (!f.some((x: any) => x.name === 'PGID')) continue;
    const rows = readRecords(buf, h, f) as any[];
    const resolve = rows.filter(r => pgids.has(r.PGID)).length;
    console.log(`  ${t.name.padEnd(6)} ${String(rows.length).padStart(5)} rows, ` +
      `PGID resolves ${resolve}/${rows.length}`);
  } catch { /* skip */ }
}

console.log('\n=== 2. tables with a PPOS column (position duplicated) ===');
for (const t of toc) {
  try {
    const h = parseTableHeader(buf, t.realOffset);
    if (h.currentRecords === 0) continue;
    const f = parseFieldDescriptors(buf, h);
    if (f.some((x: any) => x.name === 'PPOS')) {
      console.log(`  ${t.name.padEnd(6)} ${h.currentRecords} rows`);
    }
  } catch { /* skip */ }
}

console.log('\n=== 3. how many PLAY fields does each table duplicate? ===');
const playFieldNames = new Set(play.f.map((x: any) => x.name));
for (const t of toc) {
  try {
    const h = parseTableHeader(buf, t.realOffset);
    if (h.currentRecords === 0 || t.name === 'PLAY') continue;
    const f = parseFieldDescriptors(buf, h);
    const shared = f.filter((x: any) => playFieldNames.has(x.name)).map((x: any) => x.name);
    if (shared.length >= 5) {
      console.log(`  ${t.name.padEnd(6)} ${String(shared.length).padStart(3)} shared fields, ${h.currentRecords} rows`);
    }
  } catch { /* skip */ }
}

console.log('\n=== 4. TEAM unit ratings: are they DERIVED from the roster? ===');
const team = load('TEAM');
const byTeam = new Map<number, any[]>();
for (const p of play.rows) {
  const t = playerTeam(p.PGID);
  if (!byTeam.has(t)) byTeam.set(t, []);
  byTeam.get(t)!.push(p);
}
const corr = (a: number[], b: number[]) => {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
};
const unitMap: [string, string[]][] = [
  ['TRQB', ['QB']], ['TRRB', ['HB', 'FB']], ['TWRR', ['WR', 'TE']],
  ['TROL', ['LT', 'LG', 'C', 'RG', 'RT']], ['TRDL', ['LE', 'RE', 'DT']],
  ['TRLB', ['LOLB', 'MLB', 'ROLB']], ['TRDB', ['CB', 'FS', 'SS']],
  ['TRST', ['K', 'P']],
];
const fbs = team.rows.filter(t => byTeam.has(t.TGID));
for (const [field, positions] of unitMap) {
  const xs: number[] = [], ys: number[] = [];
  for (const t of fbs) {
    const players = byTeam.get(t.TGID)!.filter(p => positions.includes(PLAYER_POSITIONS[p.PPOS]));
    if (!players.length) continue;
    const mean = players.reduce((s, p) => s + ratingToDisplay(p.POVR), 0) / players.length;
    xs.push(mean); ys.push(t[field]);
  }
  console.log(`  ${field} vs mean ${positions.join('/')} POVR: corr ${corr(xs, ys).toFixed(3)} (n=${xs.length})`);
}
const xs: number[] = [], ys: number[] = [];
for (const t of fbs) {
  const top = byTeam.get(t.TGID)!.map(p => ratingToDisplay(p.POVR)).sort((a, b) => b - a).slice(0, 25);
  xs.push(top.reduce((s, v) => s + v, 0) / top.length); ys.push(t.TROV);
}
console.log(`  TROV vs top-25 mean POVR: corr ${corr(xs, ys).toFixed(3)}`);

console.log('\n=== 5. DCHT depth chart: ordered by rating? ===');
const dcht = load('DCHT');
console.log(`  DCHT ${dcht.rows.length} rows, fields: ${dcht.f.map((x: any) => x.name).join(' ')}`);
const povr = new Map(play.rows.map(p => [p.PGID, p.POVR]));
// group by (team, PPOS) and see if row order tracks rating
let ordered = 0, groups = 0;
const g = new Map<string, any[]>();
for (const r of dcht.rows) {
  const k = `${playerTeam(r.PGID)}|${r.PPOS}`;
  if (!g.has(k)) g.set(k, []);
  g.get(k)!.push(r);
}
for (const [, rows] of g) {
  if (rows.length < 2) continue;
  groups++;
  const r = rows.map(x => povr.get(x.PGID) ?? 0);
  if (r.every((v, i) => i === 0 || r[i - 1] >= v)) ordered++;
}
console.log(`  (team,PPOS) groups in stored order sorted by POVR desc: ${ordered}/${groups}`);
