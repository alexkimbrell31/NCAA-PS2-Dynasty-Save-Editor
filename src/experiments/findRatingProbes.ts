/**
 * Identify the most useful players to look up in-game to complete the rating LUT.
 *
 * Ratings are 5-bit indices into a shared 32-entry lookup table. We currently
 * know 10 of 32 entries. For each unknown raw value we surface an easily
 * identifiable player (starter-ish, named, on a real team) whose POVR/PSPD/
 * PSTR/PAWR hits that value, so a single in-game roster screen resolves it.
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
import { PLAYER_WEIGHT_OFFSET } from '../lib/eadb.ts';

/** Confirmed LUT entries: raw 5-bit value -> displayed 0-99 rating. */
const KNOWN_LUT = new Map<number, number>([
  [6, 62], [7, 65], [11, 74], [14, 80], [19, 87],
  [22, 90], [25, 93], [27, 95], [29, 97], [30, 98],
]);

const RATING_FIELDS = ['POVR', 'PSPD', 'PSTR', 'PAWR'] as const;
const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));

  const playEntry = findTable(toc, 'PLAY');
  const playHeader = parseTableHeader(buf, playEntry.realOffset);
  const playFields = parseFieldDescriptors(buf, playHeader);
  const recs = readRecords(buf, playHeader, playFields);

  const teamEntry = findTable(toc, 'TEAM');
  const teamHeader = parseTableHeader(buf, teamEntry.realOffset);
  const teamFields = parseFieldDescriptors(buf, teamHeader);
  const teamName = new Map<number, string>();
  for (const t of readRecords(buf, teamHeader, teamFields)) {
    teamName.set(
      num(t.TGID),
      [t.TMNA, t.TDNA].filter((v) => typeof v === 'string' && v).join(' ').trim(),
    );
  }

  // --- Raw distribution, to show which values actually occur ----------------
  console.log('=== Raw value distribution (POVR) ===');
  const ovrDist = new Map<number, number>();
  for (const r of recs) {
    const v = num(r.POVR);
    ovrDist.set(v, (ovrDist.get(v) ?? 0) + 1);
  }
  console.table(
    [...ovrDist.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([raw, count]) => ({
        raw,
        count,
        known: KNOWN_LUT.has(raw) ? KNOWN_LUT.get(raw) : '',
      })),
  );

  // --- Pick one clean probe per missing raw value ---------------------------
  // Prefer high-overall players: they are easy to find on a depth chart and
  // their names are more likely to be memorable on the roster screen.
  const missing = [...Array(32).keys()].filter((v) => !KNOWN_LUT.has(v));
  console.log(`\n=== ${missing.length} unknown LUT entries: ${missing.join(', ')} ===\n`);

  for (const field of RATING_FIELDS) {
    const probes: string[] = [];
    for (const raw of missing) {
      // Candidates: this field equals the missing raw value. Rank by overall
      // so we surface a recognisable player rather than a deep reserve.
      const cands = recs
        .filter((r) => num(r[field]) === raw)
        .sort((a, b) => num(b.POVR) - num(a.POVR));
      if (cands.length === 0) continue;
      const r = cands[0];
      const n = playerName(r);
      const tgid = playerTeam(num(r.PGID));
      const ht = num(r.PHGT);
      probes.push(
        `  raw ${String(raw).padStart(2)} -> ?  ${`${n.first} ${n.last}`.padEnd(22)} ` +
          `${(teamName.get(tgid) ?? '?').padEnd(28)} ` +
          `${PLAYER_POSITIONS[num(r.PPOS)].padEnd(4)} #${String(num(r.PJEN)).padStart(2)} ` +
          `${Math.floor(ht / 12)}'${ht % 12}" ${num(r.PWGT) + PLAYER_WEIGHT_OFFSET}lb ` +
          `${PLAYER_YEARS[num(r.PYER)]}  (OVR raw ${num(r.POVR)})`,
      );
    }
    console.log(`--- ${field} probes (${probes.length}) ---`);
    console.log(probes.join('\n'));
    console.log();
  }
}

main();
