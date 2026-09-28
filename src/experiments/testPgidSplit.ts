/**
 * Test whether PLAY.PGID is a composite key encoding team + roster slot.
 *
 * Evidence for the hypothesis: PGID is 16 bits spanning 70..16155 but there are
 * only 7404 players, so the space is sparse. 16155 >> 7 == 126, and there are
 * ~119 FBS teams. If PGID = (team << 7) | slot, grouping by the high bits
 * should yield ~119-203 groups of plausible roster size, and every member of a
 * group should appear together in the depth chart.
 *
 * We try several split points and score them.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function load(buf: Buffer, toc: ReturnType<typeof parseToc>, name: string) {
  const e = findTable(toc, name);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { entry: e, header: h, fields: f, records: readRecords(buf, h, f) };
}

function main() {
  const buf = readSaveFile();
  const fileHeader = parseFileHeader(buf);
  const toc = parseToc(buf, fileHeader);

  const play = load(buf, toc, 'PLAY');
  const team = load(buf, toc, 'TEAM');
  const pgids = play.records.map((r) => num(r.PGID));

  console.log(`PLAY ${play.records.length} players, PGID ${Math.min(...pgids)}..${Math.max(...pgids)}`);
  console.log(`TEAM ${team.records.length} teams\n`);

  console.log('=== Candidate PGID splits: PGID >> shift = team, PGID & mask = slot ===');
  for (const shift of [6, 7, 8, 9]) {
    const groups = new Map<number, number[]>();
    for (const p of pgids) {
      const g = p >> shift;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(p & ((1 << shift) - 1));
    }
    const sizes = [...groups.values()].map((v) => v.length);
    sizes.sort((a, b) => a - b);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    console.log(
      `  shift=${shift}: ${groups.size} groups, size min=${sizes[0]} ` +
        `median=${sizes[Math.floor(sizes.length / 2)]} max=${sizes[sizes.length - 1]} mean=${mean.toFixed(1)}`,
    );
  }

  // The depth chart is stored grouped by team. If the split is right, every
  // DCHT row's player should belong to the same group as its neighbours.
  const dcht = load(buf, toc, 'DCHT');
  console.log('\n=== Depth chart group coherence (contiguous runs per group) ===');
  for (const shift of [6, 7, 8, 9]) {
    const seq = dcht.records.map((r) => num(r.PGID) >> shift);
    let switches = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) switches++;
    const groups = new Set(seq).size;
    console.log(
      `  shift=${shift}: ${groups} groups, ${switches} transitions ` +
        `(ideal = ${groups - 1} if perfectly grouped; ratio ${(switches / Math.max(groups - 1, 1)).toFixed(2)})`,
    );
  }

  // Best-guess split: show a roster.
  const shift = 7;
  const byTeam = new Map<number, typeof play.records>();
  for (const r of play.records) {
    const g = num(r.PGID) >> shift;
    if (!byTeam.has(g)) byTeam.set(g, []);
    byTeam.get(g)!.push(r);
  }
  const teamIds = [...byTeam.keys()].sort((a, b) => a - b);
  console.log(`\n=== Groups under shift=${shift}: ${teamIds.length} (ids ${teamIds[0]}..${teamIds[teamIds.length - 1]}) ===`);

  const sample = teamIds[0];
  const roster = byTeam.get(sample)!;
  console.log(`\nGroup ${sample} roster (${roster.length} players):`);
  console.table(
    roster.slice(0, 20).map((r) => {
      const n = playerName(r);
      return {
        PGID: num(r.PGID),
        slot: num(r.PGID) & ((1 << shift) - 1),
        name: `${n.first} ${n.last}`,
        pos: num(r.PPOS),
        num: num(r.PJEN),
        yr: num(r.PYER),
      };
    }),
  );

  // Cross-check against TEAM: do the group ids line up with TEAM.TGID?
  const tgids = new Set(team.records.map((r) => num(r.TGID)));
  const overlap = teamIds.filter((t) => tgids.has(t)).length;
  console.log(
    `\nGroup ids present in TEAM.TGID: ${overlap}/${teamIds.length} ` +
      `(TEAM.TGID has ${tgids.size} distinct, range ${Math.min(...tgids)}..${Math.max(...tgids)})`,
  );

  // Show team names for the first few groups.
  const teamByTgid = new Map(team.records.map((r) => [num(r.TGID), r]));
  console.log('\nFirst 10 groups matched to TEAM:');
  for (const t of teamIds.slice(0, 10)) {
    const tm = teamByTgid.get(t);
    const label = tm ? `${tm.TDNA ?? ''} ${tm.TMNA ?? ''}`.trim() : '<no TEAM row>';
    console.log(`  group ${t}: ${byTeam.get(t)!.length} players -> ${label}`);
  }
}

main();
