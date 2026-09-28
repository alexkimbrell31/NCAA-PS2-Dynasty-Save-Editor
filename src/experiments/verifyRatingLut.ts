/**
 * Verify the rating LUT against Zach Morris' known in-game card.
 *
 * Zach Morris (San Diego State CB #3) gives us 18 displayed ratings at once.
 * Pairing each with the raw 5-bit value we decoded yields a large slice of the
 * shared lookup table in a single shot.
 */

import {
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

/** Displayed ratings reported from the game for Zach Morris. */
const REPORTED: Record<string, number> = {
  PSPD: 92, PSTR: 44, PAWR: 89, PAGI: 91, PACC: 94, PCTH: 68,
  PCAR: 48, PJMP: 86, PBTK: 52, PTAK: 56, PTHP: 40, PTHA: 40,
  PPBK: 40, PRBK: 40, PKPR: 40, PKAC: 40, PSTA: 92, PINJ: 90,
};

/** Previously confirmed entries, from the first three anchor players. */
const PRIOR = new Map<number, number>([
  [6, 62], [7, 65], [11, 74], [14, 80], [19, 87],
  [22, 90], [25, 93], [27, 95], [29, 97], [30, 98],
]);

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const pe = findTable(toc, 'PLAY');
  const ph = parseTableHeader(buf, pe.realOffset);
  const pf = parseFieldDescriptors(buf, ph);
  const recs = readRecords(buf, ph, pf);
  const widths = new Map(pf.map((f) => [f.name, f.bits]));

  const morris = recs.find((r) => {
    const n = playerName(r);
    return n.first === 'Zach' && n.last === 'Morris' && playerTeam(num(r.PGID)) === 98;
  }) ?? recs.find((r) => {
    const n = playerName(r);
    return n.first === 'Zach' && n.last === 'Morris' && num(r.PJEN) === 3;
  });

  if (!morris) throw new Error('Zach Morris not found');

  // --- Build raw -> display pairs -------------------------------------------
  const observed = new Map<number, Set<number>>();
  const rows = Object.entries(REPORTED).map(([field, display]) => {
    const raw = num(morris[field]);
    if (!observed.has(raw)) observed.set(raw, new Set());
    observed.get(raw)!.add(display);
    const prior = PRIOR.get(raw);
    return {
      field: field.slice(1),
      bits: widths.get(field),
      raw,
      display,
      prior: prior ?? '',
      conflict: prior !== undefined && prior !== display ? 'MISMATCH' : '',
    };
  });
  rows.sort((a, b) => a.raw - b.raw);
  console.table(rows);

  // --- Consistency: does one raw ever map to two displays? ------------------
  const inconsistent = [...observed.entries()].filter(([, s]) => s.size > 1);
  console.log(
    inconsistent.length === 0
      ? `PASS  shared LUT: every raw value maps to exactly one display value`
      : `FAIL  raw values with multiple displays: ${inconsistent
          .map(([r, s]) => `${r}->{${[...s].join(',')}}`)
          .join(' ')}`,
  );

  const conflicts = rows.filter((r) => r.conflict);
  console.log(
    conflicts.length === 0
      ? `PASS  no conflicts with the 10 previously confirmed entries`
      : `FAIL  conflicts: ${conflicts.map((c) => `${c.field} raw ${c.raw}`).join(', ')}`,
  );

  // --- Merge into the full LUT ----------------------------------------------
  const lut = new Map(PRIOR);
  for (const [raw, set] of observed) lut.set(raw, [...set][0]);

  console.log('\n=== LUT so far ===');
  const table = [...Array(32).keys()].map((raw) => {
    const v = lut.get(raw);
    const prev = lut.get(raw - 1);
    return {
      raw,
      display: v ?? '?',
      delta: v !== undefined && prev !== undefined ? v - prev : '',
      source: v === undefined ? 'UNKNOWN' : PRIOR.has(raw) && observed.has(raw) ? 'both' : PRIOR.has(raw) ? 'anchors' : 'morris',
    };
  });
  console.table(table);

  const missing = [...Array(32).keys()].filter((r) => !lut.has(r));
  console.log(`Still unknown: ${missing.join(', ') || 'none'}`);

  // --- Test the raw + 68 hypothesis on the upper segment --------------------
  const upper = [...lut.entries()].filter(([r]) => r >= 18).sort((a, b) => a[0] - b[0]);
  const fits = upper.filter(([r, d]) => d === r + 68);
  console.log(
    `\nraw + 68 holds for ${fits.length}/${upper.length} known entries at raw >= 18: ` +
      upper.map(([r, d]) => `${r}->${d}${d === r + 68 ? '' : '(!)'}`).join(' '),
  );
}

main();
