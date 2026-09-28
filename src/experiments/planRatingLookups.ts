/**
 * Greedy set-cover: which few players, if we knew their full rating card,
 * would resolve the most unknown LUT entries?
 *
 * Each player carries ~19 rating fields, so one in-game roster screen yields
 * many raw->display pairs at once. We want the smallest set of easily located
 * players (starters on well-known teams) covering the 22 unknown raw values.
 */

import {
  PLAYER_POSITIONS,
  PLAYER_YEARS,
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

const KNOWN = new Set([6, 7, 11, 14, 19, 22, 25, 27, 29, 30]);
const UNKNOWN = [...Array(32).keys()].filter((v) => !KNOWN.has(v));

/** Fields the roster screen actually displays, so we can read them back. */
const VISIBLE = [
  'POVR', 'PSPD', 'PSTR', 'PAWR', 'PACC', 'PAGI', 'PCAR', 'PCTH',
  'PJMP', 'PTAK', 'PSTA', 'PTHP', 'PTHA', 'PBTK', 'PKPR', 'PKAC',
];

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));

  const pe = findTable(toc, 'PLAY');
  const ph = parseTableHeader(buf, pe.realOffset);
  const pf = parseFieldDescriptors(buf, ph);
  const recs = readRecords(buf, ph, pf);

  const te = findTable(toc, 'TEAM');
  const th = parseTableHeader(buf, te.realOffset);
  const tf = parseFieldDescriptors(buf, th);
  const teamName = new Map<number, string>();
  for (const t of readRecords(buf, th, tf)) {
    teamName.set(
      num(t.TGID),
      [t.TMNA, t.TDNA].filter((v) => typeof v === 'string' && v).join(' ').trim(),
    );
  }

  // Restrict to players who are plausibly easy to find: high overall, so they
  // are near the top of their team's roster listing.
  const pool = recs.filter((r) => num(r.POVR) >= 20);

  const coverOf = (r: (typeof recs)[number]) =>
    new Set(VISIBLE.map((f) => num(r[f])).filter((v) => UNKNOWN.includes(v)));

  const remaining = new Set(UNKNOWN);
  const picked: Array<{ rec: (typeof recs)[number]; gained: number[] }> = [];

  while (remaining.size > 0) {
    let best: (typeof recs)[number] | null = null;
    let bestGain: number[] = [];
    for (const r of pool) {
      const gain = [...coverOf(r)].filter((v) => remaining.has(v));
      if (gain.length > bestGain.length) {
        best = r;
        bestGain = gain;
      }
    }
    if (!best || bestGain.length === 0) break;
    picked.push({ rec: best, gained: bestGain.sort((a, b) => a - b) });
    for (const v of bestGain) remaining.delete(v);
  }

  console.log(`Unknown LUT entries: ${UNKNOWN.join(', ')}\n`);
  console.log(`Minimum players needed: ${picked.length}\n`);

  picked.forEach((p, i) => {
    const r = p.rec;
    const n = playerName(r);
    const ht = num(r.PHGT);
    console.log(
      `${i + 1}. ${`${n.first} ${n.last}`.padEnd(20)} ` +
        `${(teamName.get(playerTeam(num(r.PGID))) ?? '?').padEnd(26)} ` +
        `${PLAYER_POSITIONS[num(r.PPOS)].padEnd(4)} #${String(num(r.PJEN)).padStart(2)} ` +
        `${Math.floor(ht / 12)}'${ht % 12}" ${num(r.PWGT) + 160}lb ${PLAYER_YEARS[num(r.PYER)]}`,
    );
    console.log(`   resolves raw: ${p.gained.join(', ')}`);
    console.log(
      `   need: ` +
        VISIBLE.filter((f) => p.gained.includes(num(r[f])))
          .map((f) => `${f.slice(1)}(raw ${num(r[f])})`)
          .join(', '),
    );
    console.log();
  });

  if (remaining.size > 0) {
    console.log(`Not coverable from high-overall players: ${[...remaining].join(', ')}`);
  }
}

main();
