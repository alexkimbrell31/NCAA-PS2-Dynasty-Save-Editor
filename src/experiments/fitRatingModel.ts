/**
 * Fit a closed-form model to the rating LUT.
 *
 * The observed deltas fall into runs of 4, 3, 2, then 1 as the raw value
 * climbs, which suggests a piecewise-linear quantisation: the game spends its
 * limited 5-bit budget coarsely at the bottom and finely at the top, where
 * rating differences actually matter.
 */

/** Every raw -> display pair confirmed so far (4 players, 22 observations). */
const CONFIRMED = new Map<number, number>([
  [0, 40], [1, 44], [2, 48], [3, 52], [4, 56],
  [6, 62], [7, 65], [8, 68],
  [11, 74], [14, 80],
  [18, 86], [19, 87], [21, 89], [22, 90], [23, 91], [24, 92],
  [25, 93], [26, 94], [27, 95], [29, 97], [30, 98],
]);

/**
 * Candidate model: slopes 4/3/2/1 with breakpoints at raw 4, 8, 16.
 *   raw  0..4  -> 40 + 4*raw          (40..56)
 *   raw  4..8  -> 56 + 3*(raw-4)      (56..68)
 *   raw  8..16 -> 68 + 2*(raw-8)      (68..84)
 *   raw 16..31 -> 84 + 1*(raw-16)     (84..99)  == raw + 68
 */
function model(raw: number): number {
  if (raw <= 4) return 40 + 4 * raw;
  if (raw <= 8) return 56 + 3 * (raw - 4);
  if (raw <= 16) return 68 + 2 * (raw - 8);
  return 84 + (raw - 16);
}

function main() {
  const rows = [...Array(32).keys()].map((raw) => {
    const actual = CONFIRMED.get(raw);
    const predicted = model(raw);
    return {
      raw,
      predicted,
      actual: actual ?? '',
      status:
        actual === undefined ? 'predicted' : actual === predicted ? 'MATCH' : 'MISMATCH',
    };
  });
  console.table(rows);

  const tested = rows.filter((r) => r.actual !== '');
  const bad = tested.filter((r) => r.status === 'MISMATCH');
  console.log(
    bad.length === 0
      ? `PASS  model reproduces all ${tested.length} confirmed points exactly`
      : `FAIL  ${bad.length} mismatches: ${bad.map((b) => `raw ${b.raw}`).join(', ')}`,
  );

  console.log(`Range: raw 0 -> ${model(0)}, raw 31 -> ${model(31)}`);

  // Segment lengths and slopes, for the write-up.
  console.log('\nSegments:');
  console.log('  raw  0..4   slope 4   display 40..56');
  console.log('  raw  4..8   slope 3   display 56..68');
  console.log('  raw  8..16  slope 2   display 68..84');
  console.log('  raw 16..31  slope 1   display 84..99');

  // Which unknowns does the model predict, and who can confirm them?
  const unknown = [...Array(32).keys()].filter((r) => !CONFIRMED.has(r));
  console.log(`\nUnverified raw values (${unknown.length}): ` +
    unknown.map((r) => `${r}->${model(r)}`).join(', '));
  console.log(
    '\nJohnny Harrison (Navy FB #34) tests the ambiguous 14..18 region:\n' +
      '  CTH raw  5 -> predict 59\n' +
      '  STR raw  9 -> predict 70\n' +
      '  AWR raw 13 -> predict 78\n' +
      '  AGI raw 15 -> predict 82\n' +
      '  BTK raw 15 -> predict 82\n' +
      '  SPD raw 16 -> predict 84\n' +
      '  ACC raw 17 -> predict 85',
  );
}

main();
