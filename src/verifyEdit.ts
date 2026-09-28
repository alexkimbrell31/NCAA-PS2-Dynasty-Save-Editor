/**
 * Independently verify an edited save before it goes near the game.
 *
 * editSave.ts already checks its own work, but it checks the buffer it just
 * built. This re-reads the written FILE from scratch through the normal parsing
 * path and confirms three things:
 *
 *   1. The file still parses -- header, TOC and all 82 table headers.
 *   2. The intended field changed, and nothing else in any table did.
 *   3. Jersey numbers are still unique within the edited player's team, which
 *      is the invariant that makes an in-game test unambiguous.
 *
 * Usage: node src/verifyEdit.ts <editedFile> <table> <pgid> <field>
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
  SAVE_FILE_PATH,
} from './lib/eadb.ts';

const [editedPath, tableName = 'PLAY', keyValue = '7712', fieldName = 'PJEN'] =
  process.argv.slice(2);
if (!editedPath) {
  console.error('usage: verifyEdit.ts <editedFile> [table] [pgid] [field]');
  process.exit(2);
}

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));

function load(path: string) {
  const buf = readSaveFile(path);
  const header = parseFileHeader(buf);
  const toc = parseToc(buf, header);
  return { buf, header, toc };
}

const before = load(SAVE_FILE_PATH);
const after = load(editedPath);

console.log('=== FILE STRUCTURE ===');
console.log(`parses as EA DB: magic OK, ${after.header.tableCount} tables`);
console.log(`dbSize ${after.header.dbSize === before.header.dbSize ? 'unchanged' : 'CHANGED'}`);
console.log(`file length ${after.buf.length === before.buf.length ? 'unchanged' : 'CHANGED'}`);

// Every table header must still parse; parseTableHeader throws if the 0xFFFF
// marker or the recordLenBits invariant is broken.
let ok = 0;
for (const e of after.toc) {
  try {
    parseTableHeader(after.buf, e.realOffset);
    ok++;
  } catch (err) {
    console.log(`  TABLE BROKEN ${e.name}: ${(err as Error).message}`);
  }
}
console.log(`${ok}/${after.toc.length} table headers parse cleanly`);

// --- Which records actually differ, across every table? --------------------
console.log('\n=== RECORD-LEVEL DIFF (all 82 tables) ===');
let differingRecords = 0;
const changes: string[] = [];
for (const e of after.toc) {
  const hB = parseTableHeader(before.buf, e.realOffset);
  const hA = parseTableHeader(after.buf, e.realOffset);
  const fB = parseFieldDescriptors(before.buf, hB);
  const fA = parseFieldDescriptors(after.buf, hA);
  const rB = readRecords(before.buf, hB, fB);
  const rA = readRecords(after.buf, hA, fA);
  if (rB.length !== rA.length) {
    changes.push(`${e.name}: record COUNT changed ${rB.length} -> ${rA.length}`);
    continue;
  }
  for (let i = 0; i < rB.length; i++) {
    for (const f of fA) {
      if (rB[i][f.name] !== rA[i][f.name]) {
        differingRecords++;
        changes.push(
          `${e.name}[${i}].${f.name}: ${JSON.stringify(rB[i][f.name])} -> ${JSON.stringify(rA[i][f.name])}`,
        );
      }
    }
  }
}
console.log(`${changes.length} field value(s) differ across the entire file:`);
for (const c of changes) console.log(`  ${c}`);

const expected = changes.length === 1 && changes[0].includes(`.${fieldName}:`);
console.log(
  expected
    ? `\nExactly one field changed, and it is the intended ${fieldName}.`
    : `\nWARNING: expected exactly one ${fieldName} change.`,
);

// --- Team invariant: jersey numbers stay unique ----------------------------
if (tableName === 'PLAY') {
  const e = findTable(after.toc, 'PLAY');
  const h = parseTableHeader(after.buf, e.realOffset);
  const f = parseFieldDescriptors(after.buf, h);
  const recs = readRecords(after.buf, h, f);
  const target = recs.find((r) => String(r.PGID) === keyValue);
  if (target) {
    const tgid = playerTeam(num(target.PGID));
    const roster = recs.filter((r) => playerTeam(num(r.PGID)) === tgid);
    const counts = new Map<number, number>();
    for (const p of roster) counts.set(num(p.PJEN), (counts.get(num(p.PJEN)) ?? 0) + 1);
    const dupes = [...counts].filter(([, c]) => c > 1);
    const n = playerName(target);
    console.log('\n=== TEAM INVARIANT ===');
    console.log(
      `${n.first} ${n.last} is #${num(target.PJEN)} ` +
        `${PLAYER_POSITIONS[num(target.PPOS)]} on team ${tgid}`,
    );
    console.log(
      dupes.length === 0
        ? `all ${roster.length} jersey numbers on the team are still unique`
        : `DUPLICATE NUMBERS: ${dupes.map(([j, c]) => `#${j} x${c}`).join(', ')}`,
    );
  }
}
