import { PLAYER_POSITIONS, findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader, parseToc, playerName, playerTeam, readRecords, readSaveFile } from '../lib/eadb.ts';
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);
const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (t: string) => { const h = parseTableHeader(buf, findTable(toc, t).realOffset); return readRecords(buf, h, parseFieldDescriptors(buf, h)); };
const psof = load('PSOF'), play = load('PLAY'), team = load('TEAM');
const byP = new Map(play.map((p) => [n(p.PGID), p]));
const tn = new Map(team.map((t) => [n(t.TGID), String(t.TDNA)]));
for (const [f, label] of [['suat', 'carries'], ['scca', 'catches']] as const) {
  const odd = psof.filter((r) => n(r[f]) !== 0 && !['HB','FB','QB','WR','TE'].includes(PLAYER_POSITIONS[n(byP.get(n(r.PGID))!.PPOS)]));
  console.log(`\n${label}: ${odd.length} row(s) from a non-skill position`);
  for (const r of odd) {
    const p = byP.get(n(r.PGID))!; const nm = playerName(p);
    console.log(`  ${nm.first} ${nm.last} (${PLAYER_POSITIONS[n(p.PPOS)]}, ${tn.get(playerTeam(n(r.PGID)))})  ${f}=${n(r[f])} yds=${n(r[f==='suat'?'suya':'scya'])} td=${n(r[f==='suat'?'sutd':'sctd'])}`);
  }
}
