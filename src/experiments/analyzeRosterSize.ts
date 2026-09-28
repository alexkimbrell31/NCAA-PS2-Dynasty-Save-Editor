/**
 * Can we change a team's roster SIZE?
 * Three separate limits to check:
 *   1. The PGID = TGID*70 + slot encoding (hard ceiling at 70?)
 *   2. PLAY's allocated record slots (maxRecords vs currentRecords)
 *   3. Whether roster size is stored anywhere / implied elsewhere
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, playerTeam, TEAM_ROSTER_BLOCK,
  PLAYER_POSITIONS,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, rows: readRecords(buf, h, f) as any[] };
};
const play = load('PLAY');
const team = load('TEAM');
const nameOf = new Map(team.rows.map(t => [t.TGID, t.TDNA]));

console.log('=== 1. PLAY table capacity ===');
console.log(`  currentRecords ${play.h.currentRecords}, maxRecords ${play.h.maxRecords}`);
console.log(`  FREE ROW SLOTS: ${play.h.maxRecords - play.h.currentRecords}`);
console.log(`  recordLenBytes ${play.h.recordLenBytes}`);
console.log(`  allocated data bytes ${play.h.recordLenBytes * play.h.maxRecords}`);

console.log('\n=== 2. roster sizes today ===');
const byTeam = new Map<number, any[]>();
for (const p of play.rows) {
  const t = playerTeam(p.PGID);
  if (!byTeam.has(t)) byTeam.set(t, []);
  byTeam.get(t)!.push(p);
}
const sizes = [...byTeam.values()].map(v => v.length).sort((a, b) => a - b);
console.log(`  teams with a roster: ${byTeam.size}`);
console.log(`  roster size min ${sizes[0]}, max ${sizes[sizes.length - 1]}, ` +
  `median ${sizes[Math.floor(sizes.length / 2)]}`);
const hist = new Map<number, number>();
for (const s of sizes) hist.set(s, (hist.get(s) ?? 0) + 1);
console.log('  histogram:', [...hist.entries()].sort((a, b) => a[0] - b[0])
  .map(([s, n]) => `${s}:${n}`).join(' '));

console.log('\n=== 3. slot usage within each 70-slot block ===');
let maxSlot = 0, gapTeams = 0;
const slotUse: number[] = new Array(70).fill(0);
for (const [t, ps] of byTeam) {
  const slots = ps.map(p => p.PGID % TEAM_ROSTER_BLOCK).sort((a, b) => a - b);
  maxSlot = Math.max(maxSlot, slots[slots.length - 1]);
  for (const s of slots) slotUse[s]++;
  // are slots contiguous 0..n-1?
  if (!slots.every((s, i) => s === i)) gapTeams++;
}
console.log(`  highest slot index used: ${maxSlot} (block size ${TEAM_ROSTER_BLOCK})`);
console.log(`  teams whose slots are NOT contiguous 0..n-1: ${gapTeams}/${byTeam.size}`);
console.log(`  slot occupancy: slot0 used by ${slotUse[0]} teams, ` +
  `slot 57 by ${slotUse[57]}, slot 65 by ${slotUse[65]}, slot 69 by ${slotUse[69]}`);
const freePerTeam = [...byTeam.entries()].map(([t, ps]) => TEAM_ROSTER_BLOCK - ps.length);
console.log(`  free slots per team: min ${Math.min(...freePerTeam)}, max ${Math.max(...freePerTeam)}`);

console.log('\n=== 4. is PGID space CONTIGUOUS between teams? ===');
const allPgids = play.rows.map(p => p.PGID).sort((a, b) => a - b);
console.log(`  PGID min ${allPgids[0]}, max ${allPgids[allPgids.length - 1]}`);
console.log(`  distinct ${new Set(allPgids).size}/${allPgids.length}`);
// what lies between team blocks?
const teamsSorted = [...byTeam.keys()].sort((a, b) => a - b);
let sampleShown = 0;
for (const t of teamsSorted.slice(0, 3)) {
  const ps = byTeam.get(t)!.map(p => p.PGID).sort((a, b) => a - b);
  console.log(`  TGID ${t} (${nameOf.get(t)}): PGID ${ps[0]}..${ps[ps.length - 1]} ` +
    `(block ${t * 70}..${t * 70 + 69}), ${ps.length} players`);
}

console.log('\n=== 5. do PLAY rows sit in PGID order? (does insertion need a re-sort?) ===');
let inOrder = 0;
for (let i = 1; i < play.rows.length; i++) if (play.rows[i - 1].PGID <= play.rows[i].PGID) inOrder++;
console.log(`  adjacent rows in ascending PGID: ${inOrder}/${play.rows.length - 1}`);

console.log('\n=== 6. FCS PGIDs -- what lives ABOVE the FBS blocks? ===');
const plga = load('PLGA');
const gen = plga.rows.filter(r => !new Set(play.rows.map(p => p.PGID)).has(r.PGID));
if (gen.length) {
  const gp = gen.map(r => r.PGID).sort((a, b) => a - b);
  console.log(`  PLGA generated players: PGID ${gp[0]}..${gp[gp.length - 1]} (${gen.length} of them)`);
  console.log(`  those map to TGID ${Math.floor(gp[0] / 70)}..${Math.floor(gp[gp.length - 1] / 70)}`);
  console.log(`  highest FBS PGID is ${allPgids[allPgids.length - 1]} = TGID ${Math.floor(allPgids[allPgids.length - 1] / 70)}`);
}

console.log('\n=== 7. position minimums -- what does a legal roster need? ===');
const posMin = new Map<string, number>();
const posMax = new Map<string, number>();
for (const [t, ps] of byTeam) {
  const counts = new Map<string, number>();
  for (const p of ps) {
    const pos = PLAYER_POSITIONS[p.PPOS];
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }
  for (const pos of PLAYER_POSITIONS) {
    const c = counts.get(pos) ?? 0;
    posMin.set(pos, Math.min(posMin.get(pos) ?? 99, c));
    posMax.set(pos, Math.max(posMax.get(pos) ?? 0, c));
  }
}
console.log('  pos  min  max  (across all 119 FBS rosters)');
for (const pos of PLAYER_POSITIONS) {
  console.log(`  ${pos.padEnd(4)} ${String(posMin.get(pos)).padStart(3)} ${String(posMax.get(pos)).padStart(4)}`);
}
