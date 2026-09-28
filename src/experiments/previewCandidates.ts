/**
 * Preview the leading candidates so the choice of next table is informed.
 *
 * NOTE on the previous ranking: its join detector was badly noisy. COCH.CCID
 * (213 dense values) and STAD.SGID (238 dense values) cover almost every small
 * integer, so nearly any narrow field "joins" to them at 100%. That is lesson 6
 * again -- containment in a dense key set is not evidence of a relationship.
 * Only PGID -> PLAY.PGID is meaningful here, because PLAY.PGID is sparse
 * (7,404 values scattered over 70..16,155); hitting it 100% across 1,698 rows
 * cannot happen by chance.
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
  teamName,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const header = parseFileHeader(buf);
const toc = parseToc(buf, header);
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));

function load(name: string) {
  const e = findTable(toc, name);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, recs: readRecords(buf, h, f) };
}

const play = load('PLAY');
const team = load('TEAM');
const playerByGid = new Map(play.recs.map((r) => [num(r.PGID), r]));
const teamByGid = new Map(team.recs.map((r) => [num(r.TGID), r]));
const label = (pgid: number) => {
  const p = playerByGid.get(pgid);
  if (!p) return `PGID ${pgid} (unresolved)`;
  const n = playerName(p);
  const t = teamByGid.get(playerTeam(num(p.PGID)));
  return `${n.first} ${n.last} ${PLAYER_POSITIONS[num(p.PPOS)]} ${t ? teamName(t) : '?'}`;
};

function preview(name: string, rows = 6) {
  const { h, f, recs } = load(name);
  console.log(`\n=== ${name}: ${recs.length} records x ${h.fieldCount} fields, ${h.recordLenBytes}B ===`);
  const varying = f.filter((fd) => new Set(recs.map((r) => r[fd.name])).size > 1);
  console.log(`fields: ${f.map((fd) => `${fd.name}(${fd.bits})`).join(' ')}`);
  console.log(`${varying.length} vary, ${f.length - varying.length} constant`);
  for (const r of recs.slice(0, rows)) {
    const bits = f
      .filter((fd) => varying.includes(fd))
      .map((fd) => `${fd.name}=${r[fd.name]}`)
      .join(' ');
    console.log(`  ${bits}`);
  }
}

// --- Candidate 1: the season statistics family -----------------------------
// These are the interesting ones. SCHD says 68 of 71 week-0 games were played,
// so this "preseason" save actually contains one week of real results -- which
// means these tables can be cross-checked against scores we have ALREADY
// verified, rather than against guesswork.
console.log('############ SEASON STATS FAMILY ############');
for (const t of ['PSOF', 'PSDE', 'PSKI', 'PSKP', 'PLAC']) preview(t, 4);

console.log('\n--- who are the PSOF leaders? ---');
const psof = load('PSOF');
const statFields = psof.f.filter(
  (fd) => new Set(psof.recs.map((r) => r[fd.name])).size > 1 && fd.name !== 'PGID',
);
for (const fd of statFields.slice(0, 8)) {
  const top = [...psof.recs].sort((a, b) => num(b[fd.name]) - num(a[fd.name])).slice(0, 3);
  console.log(
    `  ${fd.name.padEnd(5)}: ` +
      top.map((r) => `${num(r[fd.name])} ${label(num(r.PGID))}`).join('  |  '),
  );
}

// --- Candidate 2: recruiting -----------------------------------------------
console.log('\n\n############ RECRUITING ############');
preview('MRCT', 5);

// --- Candidate 3: bowls (self-documenting, real-world verifiable) ----------
console.log('\n\n############ BOWLS ############');
const bowl = load('BOWL');
console.log(`${bowl.recs.length} bowls, fields: ${bowl.f.map((f) => f.name).join(' ')}`);
for (const r of bowl.recs.slice(0, 10)) {
  console.log(
    `  ${String(r.BNME).padEnd(26)} ` +
      bowl.f
        .filter((f) => !f.isString)
        .map((f) => `${f.name}=${r[f.name]}`)
        .join(' '),
  );
}

// --- Candidate 4: PLGA, one row per FBS team with a NAME -------------------
console.log('\n\n############ PLGA (119 rows = one per FBS team?) ############');
const plga = load('PLGA');
for (const r of plga.recs.slice(0, 6)) {
  console.log(
    `  ${String(r.PFNA)} ${String(r.PLNA)} ` +
      `PPOS=${r.PPOS} POVR=${r.POVR} PJEN=${r.PJEN} PSTA=${r.PSTA} PRST=${r.PRST}`,
  );
}

// --- Candidate 5: awards / Heisman -----------------------------------------
console.log('\n\n############ HEIS ############');
const heis = load('HEIS');
console.log(`fields: ${heis.f.map((f) => f.name).join(' ')}`);
for (const r of heis.recs) {
  console.log(
    `  ${heis.f.map((f) => `${f.name}=${r[f.name]}`).join(' ')}   -> ${label(num(r.PGID))}`,
  );
}
