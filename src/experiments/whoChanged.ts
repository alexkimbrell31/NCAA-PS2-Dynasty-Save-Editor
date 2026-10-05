// Who are the rows whose PIMP the game rewrote?
import {
  readSaveFile,
  parseFileHeader,
  parseToc,
  parseTableHeader,
  parseFieldDescriptors,
  readRecords,
  findTable,
  playerName,
  playerTeam,
  playerRosterSlot,
  PLAYER_POSITIONS,
} from '../lib/eadb.ts';

const buf = readSaveFile('DynastySaveFiles/BASLUS-21459DDyn1');
const toc = parseToc(buf, parseFileHeader(buf));
const h = parseTableHeader(buf, findTable(toc, 'PLAY').realOffset);
const f = parseFieldDescriptors(buf, h);
const recs = readRecords(buf, h, f);

const CHANGED = [
  7034, 7035, 7036, 7037, 7038, 7039, 7040, 7041, 7042, 7043, 7044, 7045,
  7046, 7047, 7048, 7049, 7050, 7051, 7052, 7053, 7054, 7055, 7056, 7057,
];

const teams = new Set<number>();
for (let i = 7034; i <= 7103 && i < recs.length; i++) {
  const r = recs[i];
  const pgid = r.PGID as number;
  teams.add(playerTeam(pgid));
}
console.log('teams spanned by rows 7034..7103:', [...teams].join(', '));

// full team block for the edited player
const edited = recs[7056];
const tgid = playerTeam(edited.PGID as number);
console.log(`\nedited player PGID ${edited.PGID} team ${tgid} slot ${playerRosterSlot(edited.PGID as number)}`);

const rowsForTeam: number[] = [];
for (let i = 0; i < recs.length; i++) {
  if (playerTeam(recs[i].PGID as number) === tgid) rowsForTeam.push(i);
}
console.log(`team ${tgid} occupies ${rowsForTeam.length} PLAY rows: ${rowsForTeam[0]}..${rowsForTeam[rowsForTeam.length - 1]}`);
const contiguous = rowsForTeam.every((v, i) => i === 0 || v === rowsForTeam[i - 1] + 1);
console.log(`contiguous: ${contiguous}`);

console.log('\nfirst few of the changed range:');
for (let i = 7034; i <= 7040; i++) {
  const r = recs[i];
  const n = playerName(r);
  console.log(
    `  [${i}] PGID ${r.PGID} team ${playerTeam(r.PGID as number)} ` +
      `${PLAYER_POSITIONS[r.PPOS as number] ?? r.PPOS} ${n.first} ${n.last} ` +
      `#${r.PJEN} PIMP=${r.PIMP} POVR=${r.POVR}`,
  );
}

// does PIMP correlate with anything?
const teamRecs = rowsForTeam.map((i) => recs[i]);
console.log(`\nPIMP range on team: ${Math.min(...teamRecs.map((r) => r.PIMP as number))}..${Math.max(...teamRecs.map((r) => r.PIMP as number))}`);
const pimpField = f.find((x) => x.name === 'PIMP');
console.log('PIMP descriptor:', JSON.stringify(pimpField));
