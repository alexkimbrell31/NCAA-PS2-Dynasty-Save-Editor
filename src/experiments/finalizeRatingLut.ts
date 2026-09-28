/**
 * Close out the rating LUT at 32/32.
 *
 * Seth Harris' Break Tackle (raw 10) and Carrying (raw 12) were the last two
 * genuinely ambiguous entries -- each had three possible values and the model
 * predicted both correctly. raw 28 and 31 were never ambiguous: strict
 * monotonicity between confirmed neighbours leaves exactly one integer each.
 */

import {
  RATING_FIELDS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  ratingToDisplay,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

/**
 * Every raw -> display pair observed in game, across five players.
 * 30 of the 32 entries are directly observed.
 */
const OBSERVED = new Map<number, number>([
  [0, 40], [1, 44], [2, 48], [3, 52], [4, 56], [5, 59], [6, 62], [7, 65],
  [8, 68], [9, 70], [10, 72], [11, 74], [12, 76], [13, 78], [14, 80],
  [15, 82], [16, 84], [17, 85], [18, 86], [19, 87], [20, 88], [21, 89],
  [22, 90], [23, 91], [24, 92], [25, 93], [26, 94], [27, 95], [29, 97],
  [30, 98],
]);

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  // --- 1. The model must reproduce every observation -------------------------
  const mismatches = [...OBSERVED.entries()].filter(
    ([raw, display]) => ratingToDisplay(raw) !== display,
  );
  console.log(
    mismatches.length === 0
      ? `PASS  model reproduces all ${OBSERVED.size} observed entries exactly`
      : `FAIL  ${mismatches.map(([r, d]) => `raw ${r}: got ${ratingToDisplay(r)} want ${d}`).join(', ')}`,
  );

  // --- 2. The two unobserved entries must be forced by monotonicity ----------
  // An entry is forced when only one integer fits strictly between its
  // confirmed neighbours (with 99 as the hard ceiling).
  for (const raw of [28, 31]) {
    const lo = OBSERVED.get(raw - 1)!;
    const hi = raw === 31 ? 99 : OBSERVED.get(raw + 1)!;
    const span = raw === 31 ? [99] : [...Array(hi - lo - 1).keys()].map((i) => lo + 1 + i);
    console.log(
      span.length === 1 && span[0] === ratingToDisplay(raw)
        ? `PASS  raw ${raw} forced to ${span[0]} (strictly between ${lo} and ${hi})`
        : `WARN  raw ${raw} has ${span.length} candidates: ${span.join(', ')}`,
    );
  }

  // --- 3. Monotonic and fully within 40..99 ---------------------------------
  const all = [...Array(32).keys()].map(ratingToDisplay);
  const monotonic = all.every((v, i) => i === 0 || v > all[i - 1]);
  console.log(
    monotonic && all[0] === 40 && all[31] === 99
      ? `PASS  strictly increasing, spans exactly 40..99`
      : `FAIL  monotonicity/range violated`,
  );

  // --- 4. Coverage ----------------------------------------------------------
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const pe = findTable(toc, 'PLAY');
  const ph = parseTableHeader(buf, pe.realOffset);
  const pf = parseFieldDescriptors(buf, ph);
  const recs = readRecords(buf, ph, pf);

  let total = 0;
  let observedCount = 0;
  for (const r of recs) {
    for (const f of RATING_FIELDS) {
      const v = num(r[f]);
      if (!Number.isFinite(v)) continue;
      total++;
      if (OBSERVED.has(v)) observedCount++;
    }
  }
  console.log(
    `\nCoverage: ${((observedCount / total) * 100).toFixed(2)}% of ${total.toLocaleString()} ` +
      `rating values use a directly observed entry; the remainder use raw 28/31, ` +
      `which are forced.`,
  );

  console.log('\n=== FINAL RATING TABLE (32/32) ===');
  console.log(
    [...Array(32).keys()]
      .map((r) => `${String(r).padStart(2)}->${ratingToDisplay(r)}`)
      .join('  '),
  );
}

main();
