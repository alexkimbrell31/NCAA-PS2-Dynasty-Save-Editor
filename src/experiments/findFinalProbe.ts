/**
 * Find a single player who pins down BOTH remaining uncertain LUT entries.
 *
 * raw 28 and 31 are forced by monotonicity (27->95, 29->97 leaves only 96;
 * 30->98 plus the 99 cap leaves only 99). raw 10 and 12 are NOT forced:
 *   raw 10 lies strictly between 70 and 74  -> 71, 72 or 73
 *   raw 12 lies strictly between 74 and 78  -> 75, 76 or 77
 * So only two entries carry genuine ambiguity, three possibilities each.
 */

import {
  PLAYER_POSITIONS,
  PLAYER_YEARS,
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
import { PLAYER_WEIGHT_OFFSET } from '../lib/eadb.ts';

const TARGETS = [10, 12];

/** Visible on the in-game rating card. */
const VISIBLE = [
  'POVR', 'PSPD', 'PSTR', 'PAWR', 'PACC', 'PAGI', 'PCAR', 'PCTH', 'PJMP',
  'PTAK', 'PSTA', 'PINJ', 'PTHP', 'PTHA', 'PBTK', 'PPBK', 'PRBK', 'PKPR', 'PKAC',
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

  // Want a player who carries BOTH target values, and who is easy to find:
  // high overall so they sit near the top of their team's depth chart.
  const scored = recs
    .map((r) => {
      const present = new Set(VISIBLE.map((f) => num(r[f])));
      const hits = TARGETS.filter((t) => present.has(t));
      return { r, hits };
    })
    .filter((x) => x.hits.length === TARGETS.length)
    .sort((a, b) => num(b.r.POVR) - num(a.r.POVR));

  console.log(`Players carrying both raw 10 and raw 12: ${scored.length}\n`);
  console.log('Best candidates (highest overall = easiest to locate in game):\n');

  for (const { r } of scored.slice(0, 5)) {
    const n = playerName(r);
    const ht = num(r.PHGT);
    const tgid = playerTeam(num(r.PGID));
    const which = (t: number) =>
      VISIBLE.filter((f) => num(r[f]) === t).map((f) => f.slice(1)).join('/');

    console.log(
      `  ${`${n.first} ${n.last}`.padEnd(20)} ${(teamName.get(tgid) ?? '?').padEnd(26)} ` +
        `${PLAYER_POSITIONS[num(r.PPOS)].padEnd(4)} #${String(num(r.PJEN)).padStart(2)} ` +
        `${Math.floor(ht / 12)}'${ht % 12}" ${num(r.PWGT) + PLAYER_WEIGHT_OFFSET}lb ` +
        `${PLAYER_YEARS[num(r.PYER)]}  OVR ${ratingToDisplay(num(r.POVR))}`,
    );
    console.log(`     raw 10 -> ${which(10)}   (predict 72, could be 71/72/73)`);
    console.log(`     raw 12 -> ${which(12)}   (predict 76, could be 75/76/77)`);
    console.log();
  }

  // Full card of the single best pick, so every value can be cross-checked.
  if (scored.length > 0) {
    const r = scored[0].r;
    const n = playerName(r);
    console.log(`=== Full predicted card: ${n.first} ${n.last} ===`);
    console.table(
      VISIBLE.map((f) => ({
        field: f.slice(1),
        raw: num(r[f]),
        predicted: ratingToDisplay(num(r[f])),
        status: TARGETS.includes(num(r[f])) ? 'UNCERTAIN' : 'confirmed',
      })).sort((a, b) => a.raw - b.raw),
    );
  }

  // How much of the file actually depends on the two uncertain entries?
  let total = 0;
  let uncertain = 0;
  for (const r of recs) {
    for (const f of RATING_FIELDS) {
      const v = num(r[f]);
      if (!Number.isFinite(v)) continue;
      total++;
      if (TARGETS.includes(v)) uncertain++;
    }
  }
  console.log(
    `\n${uncertain.toLocaleString()} of ${total.toLocaleString()} rating values ` +
      `(${((uncertain / total) * 100).toFixed(2)}%) depend on raw 10 or 12.`,
  );
}

main();
