/**
 * List Washington's jersey numbers so a test edit can pick a number that is
 * genuinely free.
 *
 * Worth checking rather than assuming: if the target number is already worn by
 * a team-mate, an in-game test becomes ambiguous. The game might renumber one
 * of them, refuse the duplicate, or display both -- and we would not be able to
 * tell that outcome apart from the save being rejected outright, which is the
 * actual question the test is meant to answer.
 */
import {
  PLAYER_POSITIONS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const WASHINGTON_TGID = 110;

const buf = readSaveFile();
const header = parseFileHeader(buf);
const toc = parseToc(buf, header);
const entry = findTable(toc, 'PLAY');
const hdr = parseTableHeader(buf, entry.realOffset);
const fields = parseFieldDescriptors(buf, hdr);
const records = readRecords(buf, hdr, fields);

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
const roster = records.filter((r) => playerTeam(num(r.PGID)) === WASHINGTON_TGID);

const used = new Map<number, string[]>();
for (const p of roster) {
  const n = playerName(p);
  const jersey = num(p.PJEN);
  if (!used.has(jersey)) used.set(jersey, []);
  used.get(jersey)!.push(`${PLAYER_POSITIONS[num(p.PPOS)]} ${n.first} ${n.last}`);
}

console.log(`Washington: ${roster.length} players wearing ${used.size} distinct numbers`);

// Real college rosters reuse numbers across offence and defence, so duplicates
// are expected and are not by themselves a problem.
const dupes = [...used].filter(([, v]) => v.length > 1);
console.log(`\n${dupes.length} numbers are already shared by EA's own roster:`);
for (const [n, v] of dupes.slice(0, 8)) {
  console.log(`  #${String(n).padStart(2)}: ${v.join('  |  ')}`);
}

const free: number[] = [];
for (let n = 0; n <= 99; n++) if (!used.has(n)) free.push(n);

console.log(`\n${free.length} numbers are completely unused: ${free.join(', ')}`);

// NCAA numbering convention: interior defensive linemen wear 50-79 or 90-99.
// Staying inside it keeps the edit plausible to the game's own validation.
const dlLegal = free.filter((n) => (n >= 50 && n <= 79) || (n >= 90 && n <= 99));
console.log(`\nFree AND conventional for a DT (50-79 / 90-99): ${dlLegal.join(', ')}`);

console.log('\nStatus of candidate numbers:');
for (const n of [77, 78, 79, 90, 95, 96, 97, 98, 99]) {
  const t = used.get(n);
  console.log(`  #${String(n).padStart(2)}: ${t ? `TAKEN by ${t.join(' | ')}` : 'FREE'}`);
}

const whitaker = roster.find((r) => playerName(r).last === 'Whitaker');
if (whitaker) {
  const n = playerName(whitaker);
  console.log(
    `\nTarget: ${n.first} ${n.last}, PGID=${num(whitaker.PGID)}, ` +
      `currently #${num(whitaker.PJEN)} ${PLAYER_POSITIONS[num(whitaker.PPOS)]}`,
  );
}
