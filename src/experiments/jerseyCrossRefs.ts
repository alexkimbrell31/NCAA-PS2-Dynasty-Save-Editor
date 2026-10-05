// Does PJEN (or the player's identity) appear in any other table?
// Scan every table for a field whose value matches the edited player's jersey,
// and specifically check PLGA, which is known to duplicate PLAY fields.

import {
  readSaveFile,
  parseFileHeader,
  parseToc,
  parseTableHeader,
  parseFieldDescriptors,
  readRecords,
  findTable,
  playerTeam,
  playerRosterSlot,
} from '../lib/eadb.ts';

const buf = readSaveFile('DynastySaveFiles/BASLUS-21459DDyn1');
const toc = parseToc(buf, parseFileHeader(buf));

const TARGET_PGID = 7712;
const TARGET_JERSEY = 94;

function load(name: string) {
  const t = findTable(toc, name);
  const h = parseTableHeader(buf, t.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, recs: readRecords(buf, h, f) };
}

// ---- 1. PLAY field list, does PJEN exist elsewhere by name? ----
const play = load('PLAY');
const playFieldNames = new Set(play.f.map((x) => x.name));
console.log(`PLAY has ${play.f.length} fields`);

console.log('\n=== TABLES SHARING FIELD NAMES WITH PLAY ===');
for (const t of toc) {
  if (t.name === 'PLAY') continue;
  let h, f;
  try {
    h = parseTableHeader(buf, t.realOffset);
    f = parseFieldDescriptors(buf, h);
  } catch {
    continue;
  }
  const shared = f.filter((x) => playFieldNames.has(x.name)).map((x) => x.name);
  if (shared.length === 0) continue;
  const hasJersey = shared.includes('PJEN');
  console.log(
    `  ${t.name.padEnd(6)} rows=${String(h.currentRecords).padStart(5)} shared=${String(shared.length).padStart(3)}` +
      (hasJersey ? '   *** HAS PJEN ***' : ''),
  );
  if (hasJersey) console.log(`      shared: ${shared.join(' ')}`);
}

// ---- 2. Any table with a PGID field referencing our player ----
console.log('\n=== TABLES REFERENCING PGID 7712 ===');
for (const t of toc) {
  let h, f, recs;
  try {
    h = parseTableHeader(buf, t.realOffset);
    f = parseFieldDescriptors(buf, h);
    recs = readRecords(buf, h, f);
  } catch {
    continue;
  }
  const pgidFields = f.filter((x) => /GID$/.test(x.name) && x.name !== 'TGID');
  for (const pf of pgidFields) {
    const hits = recs.filter((r) => r[pf.name] === TARGET_PGID);
    if (hits.length)
      console.log(`  ${t.name}.${pf.name}: ${hits.length} row(s)`);
  }
}

// ---- 3. Any table holding the value 94 in a plausible jersey field ----
console.log('\n=== PLGA DETAIL ===');
try {
  const plga = load('PLGA');
  console.log(`PLGA rows=${plga.recs.length} fields=${plga.f.length}`);
  const names = plga.f.map((x) => x.name);
  console.log(`fields: ${names.join(' ')}`);
  const jerseyLike = plga.f.filter((x) => x.name === 'PJEN');
  if (jerseyLike.length) {
    const rows = plga.recs.filter((r) => r.PGID === TARGET_PGID);
    console.log(`PLGA rows for PGID ${TARGET_PGID}: ${rows.length}`);
    for (const r of rows)
      console.log(`  PJEN=${r.PJEN} (PLAY has ${TARGET_JERSEY})`);
  }
} catch (e) {
  console.log('  PLGA: ' + (e as Error).message);
}

// ---- 4. DCHT / depth chart referencing roster slot ----
console.log('\n=== TABLES WITH A FIELD WHOSE VALUE == 94 FOR SOME ROW LINKED TO TEAM 110 ===');
const tgid = playerTeam(TARGET_PGID);
const slot = playerRosterSlot(TARGET_PGID);
console.log(`team ${tgid}, roster slot ${slot}`);
for (const t of toc) {
  let h, f, recs;
  try {
    h = parseTableHeader(buf, t.realOffset);
    f = parseFieldDescriptors(buf, h);
    recs = readRecords(buf, h, f);
  } catch {
    continue;
  }
  if (!f.some((x) => x.name === 'TGID')) continue;
  const teamRows = recs.filter((r) => r.TGID === tgid);
  if (!teamRows.length) continue;
  for (const fd of f) {
    if (fd.isString || fd.isRaw) continue;
    const n = teamRows.filter((r) => r[fd.name] === TARGET_JERSEY).length;
    if (n > 0 && n <= 3)
      console.log(`  ${t.name}.${fd.name}: ${n} row(s) on team ${tgid} hold 94`);
  }
}
