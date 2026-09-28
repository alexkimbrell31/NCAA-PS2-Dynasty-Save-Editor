/**
 * Blind test of the rating model against Johnny Harrison.
 *
 * The model was fitted WITHOUT any data from this player, and it predicted the
 * ambiguous raw 14..18 region by interpolation alone. These are therefore
 * genuine out-of-sample predictions, not a refit.
 */

import {
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

/** Displayed ratings reported from the game for Johnny Harrison (Navy FB #34). */
const REPORTED: Record<string, number> = {
  POVR: 88, PSPD: 84, PSTR: 70, PAWR: 78, PAGI: 82, PACC: 85,
  PCTH: 59, PCAR: 80, PJMP: 68, PBTK: 82, PTAK: 40, PTHP: 40,
  PTHA: 40, PPBK: 52, PRBK: 59, PKPR: 40, PKAC: 40, PSTA: 80,
  PINJ: 68,
};

/** Raw values that had never been directly observed before this player. */
const PREVIOUSLY_UNOBSERVED = new Set([5, 9, 10, 12, 13, 15, 16, 17, 20, 28, 31]);

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const pe = findTable(toc, 'PLAY');
  const ph = parseTableHeader(buf, pe.realOffset);
  const pf = parseFieldDescriptors(buf, ph);
  const recs = readRecords(buf, ph, pf);

  const rec = recs.find((r) => {
    const n = playerName(r);
    return n.first === 'Johnny' && n.last === 'Harrison' && num(r.PJEN) === 34;
  });
  if (!rec) throw new Error('Johnny Harrison not found');
  console.log(`Johnny Harrison  TGID ${playerTeam(num(rec.PGID))}  #${num(rec.PJEN)}\n`);

  const rows = Object.entries(REPORTED).map(([field, actual]) => {
    const raw = num(rec[field]);
    const predicted = ratingToDisplay(raw);
    return {
      field: field.slice(1),
      raw,
      predicted,
      actual,
      err: actual - predicted,
      blind: PREVIOUSLY_UNOBSERVED.has(raw) ? 'OUT-OF-SAMPLE' : '',
      status: predicted === actual ? 'MATCH' : 'MISMATCH',
    };
  });
  rows.sort((a, b) => a.raw - b.raw);
  console.table(rows);

  const wrong = rows.filter((r) => r.status === 'MISMATCH');
  const blind = rows.filter((r) => r.blind);
  console.log(
    wrong.length === 0
      ? `PASS  model predicted all ${rows.length} ratings exactly ` +
        `(${blind.length} of them out-of-sample)`
      : `FAIL  ${wrong.length} mismatches: ` +
        wrong.map((w) => `${w.field} raw ${w.raw} pred ${w.predicted} got ${w.actual}`).join(', '),
  );

  const nowConfirmed = [...new Set(blind.map((b) => b.raw))].sort((a, b) => a - b);
  console.log(`Newly confirmed raw values: ${nowConfirmed.join(', ')}`);
  const stillOpen = [...PREVIOUSLY_UNOBSERVED].filter((v) => !nowConfirmed.includes(v));
  console.log(`Still interpolated: ${stillOpen.sort((a, b) => a - b).join(', ') || 'none'}`);

  // How much of the roster is now covered by directly confirmed values?
  const confirmed = new Set([
    0, 1, 2, 3, 4, 6, 7, 8, 11, 14, 18, 19, 21, 22, 23, 24, 25, 26, 27, 29, 30,
    ...nowConfirmed,
  ]);
  let total = 0;
  let covered = 0;
  for (const r of recs) {
    for (const f of RATING_FIELDS) {
      const v = num(r[f]);
      if (!Number.isFinite(v)) continue;
      total++;
      if (confirmed.has(v)) covered++;
    }
  }
  console.log(
    `\nCoverage: ${((covered / total) * 100).toFixed(2)}% of all ${total.toLocaleString()} ` +
      `rating values in the file now use a directly confirmed LUT entry ` +
      `(${confirmed.size}/32 entries confirmed).`,
  );
}

main();
