/**
 * Verify that PGID encodes the team: PGID = TGID*70 + rosterSlot.
 *
 * Found by gap analysis: contiguous PGID runs start at 70, 140, 210, 350, 420,
 * 490, 560, 630, 700, 770, 840, 910, 980 -- all multiples of 70. Max PGID is
 * 16155, and 16155/70 = 230, which matches TEAM.TGID's observed range of 1..231.
 *
 * Block size 70 is not a power of two, which is why every bit-shift hypothesis
 * failed: the split is arithmetic, not bitwise.
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

const BLOCK = 70;
const num = (v: number | string) => (typeof v === 'number' ? v : NaN);
const str = (v: number | string) => (typeof v === 'string' ? v : String(v));

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
  const dcht = load(buf, toc, 'DCHT');

  const teamByTgid = new Map(team.records.map((r) => [num(r.TGID), r]));

  // --- Group players by derived team --------------------------------------
  const rosters = new Map<number, typeof play.records>();
  for (const r of play.records) {
    const t = Math.floor(num(r.PGID) / BLOCK);
    if (!rosters.has(t)) rosters.set(t, []);
    rosters.get(t)!.push(r);
  }
  const sizes = [...rosters.values()].map((v) => v.length).sort((a, b) => a - b);

  console.log(`Derived teams: ${rosters.size}`);
  console.log(
    `Roster size: min=${sizes[0]} median=${sizes[Math.floor(sizes.length / 2)]} max=${sizes[sizes.length - 1]}`,
  );

  // Check 1: no roster may exceed the block size.
  const oversize = sizes.filter((s) => s > BLOCK).length;
  console.log(`Rosters exceeding ${BLOCK} slots: ${oversize}  ${oversize === 0 ? 'PASS' : 'FAIL'}`);

  // Check 2: every derived team id must exist in TEAM.
  const missing = [...rosters.keys()].filter((t) => !teamByTgid.has(t));
  console.log(
    `Derived team ids absent from TEAM.TGID: ${missing.length}` +
      (missing.length ? ` -> ${missing.join(', ')}` : '  PASS'),
  );

  // Check 3: every roster should cover a full set of positions.
  let fullRosters = 0;
  for (const [, players] of rosters) {
    const pos = new Set(players.map((p) => num(p.PPOS)));
    if (pos.size >= 18) fullRosters++;
  }
  console.log(
    `Rosters covering >=18 of 21 positions: ${fullRosters}/${rosters.size} ` +
      `${fullRosters / rosters.size > 0.95 ? 'PASS' : 'CHECK'}`,
  );

  // Check 4: jersey numbers should be unique within a team.
  let dupTeams = 0;
  for (const [, players] of rosters) {
    const jerseys = players.map((p) => num(p.PJEN));
    if (new Set(jerseys).size !== jerseys.length) dupTeams++;
  }
  console.log(`Teams with duplicate jersey numbers: ${dupTeams}/${rosters.size}`);

  // --- Show real rosters ---------------------------------------------------
  console.log('\n=== Sample rosters ===');
  for (const tgid of [...rosters.keys()].sort((a, b) => a - b).slice(0, 6)) {
    const tm = teamByTgid.get(tgid);
    const name = tm ? `${str(tm.TDNA)} ${str(tm.TMNA)}`.trim() : '<unknown>';
    console.log(`  TGID ${String(tgid).padStart(3)}  ${String(rosters.get(tgid)!.length).padStart(2)} players  ${name}`);
  }

  // Full roster for one team.
  const tgid = [...rosters.keys()].sort((a, b) => a - b)[1];
  const tm = teamByTgid.get(tgid);
  console.log(`\nRoster for TGID ${tgid} (${tm ? `${str(tm.TDNA)} ${str(tm.TMNA)}` : '?'}):`);
  console.table(
    rosters
      .get(tgid)!
      .sort((a, b) => num(a.PPOS) - num(b.PPOS))
      .slice(0, 15)
      .map((r) => {
        const n = playerName(r);
        const h = num(r.PHGT);
        return {
          PGID: num(r.PGID),
          slot: num(r.PGID) % BLOCK,
          name: `${n.first} ${n.last}`,
          pos: num(r.PPOS),
          '#': num(r.PJEN),
          yr: num(r.PYER),
          ht: `${Math.floor(h / 12)}'${h % 12}"`,
          wt: num(r.PWGT) + 160,
        };
      }),
  );

  // --- Cross-check with DCHT ----------------------------------------------
  // Each depth chart entry must belong to the same team as its neighbours.
  const dchtTeams = dcht.records.map((r) => Math.floor(num(r.PGID) / BLOCK));
  let transitions = 0;
  for (let i = 1; i < dchtTeams.length; i++) if (dchtTeams[i] !== dchtTeams[i - 1]) transitions++;
  const distinct = new Set(dchtTeams).size;
  console.log(
    `\nDCHT: ${distinct} teams, ${transitions} transitions ` +
      `(${distinct - 1} would be perfectly grouped) ` +
      `${transitions === distinct - 1 ? 'PASS - depth charts are contiguous per team' : ''}`,
  );

  // --- Which teams have no players? ---------------------------------------
  const withPlayers = new Set(rosters.keys());
  const empty = team.records.filter((r) => !withPlayers.has(num(r.TGID)));
  console.log(`\nTEAM rows with no players: ${empty.length} of ${team.records.length}`);
  console.log(
    '  e.g. ' +
      empty
        .slice(0, 8)
        .map((r) => `${str(r.TDNA)}(${num(r.TGID)})`)
        .join(', '),
  );
}

main();
