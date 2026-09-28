/**
 * HEIS, second pass. Decode the ten candidates properly (display ratings,
 * position names, real teams) and try to work out what the PA** columns are.
 */

import {
  PLAYER_POSITIONS,
  RATING_FIELDS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  ratingToDisplay,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (tag: string) => {
    const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { h, f, rows: readRecords(buf, h, f) };
  };

  const heis = load('HEIS');
  const play = load('PLAY');
  const team = load('TEAM');
  const byPgid = new Map(play.rows.map((p) => [num(p.PGID), p]));
  const teamName = new Map(team.rows.map((t) => [num(t.TGID), String(t.TDNA)]));

  console.log('Heisman candidates, in HPRK order:');
  const sorted = [...heis.rows].sort((a, b) => num(a.HPRK) - num(b.HPRK));
  for (const r of sorted) {
    const p = byPgid.get(num(r.PGID))!;
    const nm = playerName(p);
    const pos = PLAYER_POSITIONS[num(p.PPOS)] ?? `#${num(p.PPOS)}`;
    console.log(
      `  #${num(r.HPRK)}  pts ${String(num(r.PCAP)).padStart(3)}  ` +
        `${`${nm.first} ${nm.last}`.padEnd(20)} ${pos.padEnd(3)} ` +
        `ovr ${String(ratingToDisplay(num(p.POVR))).padStart(3)} ` +
        `${(teamName.get(playerTeam(num(p.PGID))) ?? '?').padEnd(15)} ` +
        `CAN0=${String(num(r.CAN0)).padStart(4)} PAty=${num(r.PAty)}`,
    );
  }

  // Is PCAP strictly tied to HPRK?
  console.log(
    `\nPCAP vs HPRK: ${sorted.every((r, i) => i === 0 || num(r.PCAP) < num(sorted[i - 1].PCAP)) ? 'strictly descending' : 'NOT monotone'}`,
  );
  console.log(`PCAP values: ${sorted.map((r) => num(r.PCAP)).join(', ')}`);
  const gaps = sorted.slice(1).map((r, i) => num(sorted[i].PCAP) - num(r.PCAP));
  console.log(`gaps: ${gaps.join(', ')}`);

  // Do any PA** columns equal a PLAY field for the same player?
  const paNames = heis.f.map((f) => f.name).filter((n) => n.startsWith('PA') || n === 'CAN0');
  const playNames = play.f.map((f) => f.name);
  console.log('\nDoes any HEIS column copy a PLAY column for the same player?');
  for (const hn of paNames) {
    for (const pn of playNames) {
      const agree = heis.rows.filter((r) => {
        const p = byPgid.get(num(r.PGID))!;
        return num(r[hn]) === num(p[pn]);
      }).length;
      if (agree >= 8) console.log(`  HEIS.${hn} == PLAY.${pn} on ${agree}/10`);
    }
  }

  // CAN0 as a team: does it match the candidate's own team?
  const ownTeam = sorted.filter(
    (r) => num(r.CAN0) === playerTeam(num(byPgid.get(num(r.PGID))!.PGID)),
  ).length;
  console.log(`\nCAN0 == candidate's own TGID on ${ownTeam}/10`);

  // Are the candidates plausible? positions + ratings
  const positions = sorted.map((r) => PLAYER_POSITIONS[num(byPgid.get(num(r.PGID))!.PPOS)]);
  console.log(`positions: ${positions.join(', ')}`);
  const ovrs = sorted.map((r) => ratingToDisplay(num(byPgid.get(num(r.PGID))!.POVR)));
  console.log(`display OVRs: ${ovrs.join(', ')}`);
  const allOvr = play.rows
    .map((p) => ratingToDisplay(num(p.POVR)))
    .sort((a, b) => b - a);
  console.log(
    `for reference, the 10 highest OVRs in PLAY are ${allOvr.slice(0, 10).join(', ')} ` +
      `(median ${allOvr[Math.floor(allOvr.length / 2)]})`,
  );
  const ranks = sorted.map(
    (r) =>
      allOvr.indexOf(ratingToDisplay(num(byPgid.get(num(r.PGID))!.POVR))) + 1,
  );
  console.log(`each candidate's best-possible rank by OVR among 7404: ${ranks.join(', ')}`);

  // Are all ten distinct players, and are teams distinct?
  console.log(
    `\n${new Set(sorted.map((r) => num(r.PGID))).size}/10 distinct players, ` +
      `${new Set(sorted.map((r) => playerTeam(num(r.PGID)))).size}/10 distinct teams`,
  );

  // Any relationship between PA** and zero-ness? Season hasn't been played.
  for (const hn of paNames) {
    const zero = heis.rows.filter((r) => num(r[hn]) === 0).length;
    console.log(`  ${hn}: ${zero}/10 zero`);
  }
}

main();
