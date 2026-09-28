/**
 * MCOV (magazine cover) and MOIN (mode info) -- two single-row text tables.
 * Also settles whether CAN0 is really a TGID, which HEIS left open.
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, playerName, playerTeam, PLAYER_POSITIONS,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, rows: readRecords(buf, h, f) as any[] };
};
const mcov = load('MCOV'), moin = load('MOIN'), heis = load('HEIS');
const play = load('PLAY').rows, team = load('TEAM').rows, schd = load('SCHD').rows;
const nameOf = new Map(team.map(t => [t.TGID, t.TDNA]));
const byPgid = new Map(play.map(p => [p.PGID, p]));

console.log('=== MOIN ===');
console.log(JSON.stringify(moin.rows[0], null, 1));

console.log('\n=== MCOV ===');
const m = mcov.rows[0];
for (const f of mcov.f as any[]) console.log(`  ${f.name.padEnd(5)} (${String(f.bits).padStart(3)}b) = ${JSON.stringify(m[f.name])}`);

console.log('\n--- does MCOV.PGID resolve, and does it match the text? ---');
const p = byPgid.get(m.PGID);
if (p) {
  const { first, last } = playerName(p);
  console.log(`  PGID ${m.PGID} -> ${first} ${last}, ${PLAYER_POSITIONS[p.PPOS]} #${p.PJEN}, team ${nameOf.get(playerTeam(m.PGID))}`);
  console.log(`  MCOV.TGID ${m.TGID} -> ${nameOf.get(m.TGID)}`);
  console.log(`  player's own team == MCOV.TGID? ${playerTeam(m.PGID) === m.TGID}`);
  console.log(`  text says: "${m.MCTX}"`);
  console.log(`  text position/jersey matches player? pos=${PLAYER_POSITIONS[p.PPOS]} jersey=${p.PJEN}`);
}

console.log('\n--- CAN0: is it a TGID? (HEIS left this open) ---');
console.log(`  MCOV.CAN0 = ${m.CAN0} -> as TGID: ${nameOf.get(m.CAN0) ?? 'NOT A VALID TGID'}`);
console.log(`  MCOV cover subject is ${nameOf.get(m.TGID)}; CAN0 resolving elsewhere is evidence AGAINST the TGID reading`);
const heisCan0 = heis.rows.map(r => r.CAN0);
console.log(`  HEIS.CAN0 values: ${heisCan0.join(',')}`);
console.log(`  as teams: ${heisCan0.map(v => nameOf.get(v) ?? '?').join(', ')}`);
console.log('\n  HEIS players own teams:');
for (const r of heis.rows) {
  const pl = byPgid.get(r.PGID);
  const { first, last } = pl ? playerName(pl) : { first: '?', last: '' };
  console.log(`    rank ${r.HPRK}: ${String(first + ' ' + last).padEnd(22)} of ${String(nameOf.get(playerTeam(r.PGID))).padEnd(18)} CAN0=${r.CAN0} (${nameOf.get(r.CAN0) ?? '?'})`);
}

console.log('\n--- MCOV.SEWN / MLAY ---');
console.log(`  SEWN=${m.SEWN} (current week), MLAY=${m.MLAY}, MTTN=${m.MTTN}, MBK0=${m.MBK0}`);
console.log(`  CID0=${m.CID0} HID0=${m.HID0} CEM0=${m.CEM0} CTY0=${m.CTY0}`);
