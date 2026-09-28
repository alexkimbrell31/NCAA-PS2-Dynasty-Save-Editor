/**
 * Is PLGA a Rosetta stone for the 6-bit name encoding?
 *
 * PLGA stores PFNA/PLNA as PLAIN fixed-length text. PLAY stores names as 10+13
 * SEPARATE 6-bit fields (PF01..PF10 / PL01..PL13). If the two tables describe
 * the same players -- PLGA.PGID is in PLAY's PGID space -- then every PLGA row
 * is a free (plaintext, packed) pair.
 *
 * That matters because the missing 6-bit ENCODER is what currently blocks name
 * editing in editSave.ts. A decoder plus known plaintext is exactly what you
 * need to build and then TEST an encoder.
 */
import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  readRecords,
  readSaveFile,
  teamName,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
const str = (v: number | string) => (typeof v === 'string' ? v : '');
const load = (name: string) => {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return readRecords(buf, h, f);
};

const plga = load('PLGA');
const play = load('PLAY');
const team = load('TEAM');
const playByPgid = new Map(play.map((p) => [num(p.PGID), p]));
const teamByTgid = new Map(team.map((t) => [num(t.TGID), t]));

let hit = 0;
let nameMatch = 0;
const misses: string[] = [];

console.log('PLGA row -> PLAY row, plaintext vs 6-bit decoded:');
for (const g of plga) {
  const pgid = num(g.PGID);
  const p = playByPgid.get(pgid);
  if (!p) {
    misses.push(`PGID ${pgid} absent from PLAY`);
    continue;
  }
  hit++;
  const packed = playerName(p);
  const plain = `${str(g.PFNA)} ${str(g.PLNA)}`;
  const decoded = `${packed.first} ${packed.last}`;
  if (plain === decoded) nameMatch++;
  else if (misses.length < 12)
    misses.push(`PGID ${pgid}: PLGA "${plain}" vs PLAY "${decoded}"`);
}

console.log(`PLGA rows:                       ${plga.length}`);
console.log(`PGID resolves in PLAY:           ${hit}/${plga.length}`);
console.log(`plaintext == 6-bit decoded name: ${nameMatch}/${hit}`);
if (misses.length) console.log(`\nmismatches:\n  ${misses.join('\n  ')}`);

// Which teams do these players belong to?
const byTeam = new Map<number, number>();
for (const g of plga) {
  const t = playerTeam(num(g.PGID));
  byTeam.set(t, (byTeam.get(t) ?? 0) + 1);
}
console.log(`\nPLGA players span ${byTeam.size} team(s):`);
for (const [tgid, count] of [...byTeam].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  const t = teamByTgid.get(tgid);
  console.log(`  TGID ${String(tgid).padStart(3)} ${String(t ? teamName(t) : '?').padEnd(26)} ${count} players`);
}

// Does PLGA agree with PLAY on the shared attribute columns? That is the
// discriminating test -- two tables describing the same player must agree.
const shared = ['PWGT', 'PHGT', 'PJEN', 'PPOS', 'PYER', 'POVR', 'PSPD', 'PSTR'];
console.log('\nagreement with PLAY on shared attribute columns:');
for (const f of shared) {
  let same = 0;
  let n = 0;
  for (const g of plga) {
    const p = playByPgid.get(num(g.PGID));
    if (!p || g[f] === undefined || p[f] === undefined) continue;
    n++;
    if (num(g[f]) === num(p[f])) same++;
  }
  console.log(`  ${f}: ${same}/${n}`);
}
