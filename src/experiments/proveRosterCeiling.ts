/**
 * Prove the 70-player ceiling is STRUCTURAL, not a convention.
 * If team N's roster exceeds 70, its PGIDs collide with team N+1's block.
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, playerTeam, TEAM_ROSTER_BLOCK,
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

console.log('=== the collision argument, concretely ===');
const t = 3; // Alabama
console.log(`  TGID ${t} (${nameOf.get(t)}) owns PGID ${t * 70} .. ${t * 70 + 69}`);
console.log(`  TGID ${t + 1} (${nameOf.get(t + 1)}) owns PGID ${(t + 1) * 70} .. ${(t + 1) * 70 + 69}`);
console.log(`  a 75th player on TGID ${t} would need PGID ${t * 70 + 74} = ${t * 70 + 74}`);
console.log(`  playerTeam(${t * 70 + 74}) = ${playerTeam(t * 70 + 74)}  <-- resolves to ${nameOf.get(playerTeam(t * 70 + 74))}, NOT ${nameOf.get(t)}`);
console.log(`  => the player would silently belong to the WRONG TEAM.`);

console.log('\n=== is any slot >= 70 ever used? ===');
const slots = play.rows.map(p => p.PGID % TEAM_ROSTER_BLOCK);
console.log(`  max slot index observed: ${Math.max(...slots)} (of 0..69)`);
console.log(`  any slot >= 70: ${slots.some(s => s >= 70)}`);

console.log('\n=== largest rosters in the file ===');
const byTeam = new Map<number, number>();
for (const p of play.rows) byTeam.set(playerTeam(p.PGID), (byTeam.get(playerTeam(p.PGID)) ?? 0) + 1);
[...byTeam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  .forEach(([tg, n]) => console.log(`  ${String(nameOf.get(tg)).padEnd(20)} ${n} players (${70 - n} free slots)`));

console.log('\n=== total headroom if every team went to 70 ===');
const totalNow = play.rows.length;
const capacity = 119 * 70;
console.log(`  current FBS players: ${totalNow}`);
console.log(`  if all 119 teams carried 70: ${capacity}`);
console.log(`  additional players that would need rows: ${capacity - totalNow}`);
console.log(`  PLAY free row slots available: ${play.h.maxRecords - play.h.currentRecords}`);
console.log(`  => ${capacity - totalNow <= play.h.maxRecords - play.h.currentRecords
  ? 'FITS within maxRecords'
  : 'DOES NOT FIT -- would need relayout'}`);

console.log('\n=== real NCAA scholarship limit, for reference ===');
console.log('  FBS scholarship limit is 85; a full roster with walk-ons is ~105.');
console.log('  NCAA 07 models 70 max. Any import MUST be trimmed to fit.');

console.log('\n=== DCHT depth values ===');
const dcht = load('DCHT');
console.log(`  ddep range ${Math.min(...dcht.rows.map(r => r.ddep))}..${Math.max(...dcht.rows.map(r => r.ddep))}`);
const ddepBits = dcht.f.find((x: any) => x.name === 'ddep');
const pposBits = dcht.f.find((x: any) => x.name === 'PPOS');
const pgidBits = dcht.f.find((x: any) => x.name === 'PGID');
console.log(`  ddep is ${ddepBits.bits} bits (max ${(1 << ddepBits.bits) - 1})`);
console.log(`  DCHT.PGID is ${pgidBits.bits} bits (max ${(1 << pgidBits.bits) - 1})`);

console.log('\n=== PLAY.PGID field width -- the absolute ceiling ===');
const pgidField = play.f.find((x: any) => x.name === 'PGID');
console.log(`  PLAY.PGID is ${pgidField.bits} bits => max value ${(1 << pgidField.bits) - 1}`);
console.log(`  max TGID expressible: ${Math.floor(((1 << pgidField.bits) - 1) / 70)}`);
console.log(`  TEAM has TGID up to ${Math.max(...team.rows.map(t => t.TGID))}`);
