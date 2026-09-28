/**
 * Validate the decoded PLAY table.
 *
 * Structural tiling alone is not enough -- an earlier decode tiled bits 0..443
 * perfectly while producing pure noise. These checks are semantic: they assert
 * things that can only hold if the bit mapping is genuinely correct.
 */

import {
  PLAYER_POSITIONS,
  RATING_FIELDS,
  TEAM_ROSTER_BLOCK,
  decodeNameChar,
  displayToRating,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  PLAYER_WEIGHT_OFFSET,
  playerName,
  playerRosterSlot,
  playerTeam,
  ratingToDisplay,
  readRecords,
  readSaveFile,
} from './lib/eadb.ts';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
}

function loadTable(buf: Buffer, toc: ReturnType<typeof parseToc>, name: string) {
  const entry = findTable(toc, name);
  const header = parseTableHeader(buf, entry.realOffset);
  const fields = parseFieldDescriptors(buf, header);
  return { header, fields, records: readRecords(buf, header, fields) };
}

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const fileHeader = parseFileHeader(buf);
  const toc = parseToc(buf, fileHeader);

  const play = loadTable(buf, toc, 'PLAY');
  const recs = play.records;
  console.log(`PLAY: ${recs.length} records, ${play.fields.length} fields\n`);

  // --- Sample roster --------------------------------------------------------
  console.log('First 15 players:');
  console.table(
    recs.slice(0, 15).map((r, i) => {
      const n = playerName(r);
      const h = num(r.PHGT);
      return {
        row: i,
        name: `${n.first} ${n.last}`,
        pos: num(r.PPOS),
        num: num(r.PJEN),
        yr: num(r.PYER),
        height: `${Math.floor(h / 12)}'${h % 12}"`,
        PWGT: num(r.PWGT),
        weight: num(r.PWGT) + PLAYER_WEIGHT_OFFSET,
        POVR: num(r.POVR),
        PSPD: num(r.PSPD),
      };
    }),
  );

  // --- Names ---------------------------------------------------------------
  // A correct charset yields printable names with no unknown codes, a capital
  // first letter, and lowercase thereafter.
  let unknownCodes = 0;
  let capitalFirst = 0;
  let nonEmpty = 0;
  const codeUse = new Set<number>();
  for (const r of recs) {
    for (const key of Object.keys(r)) {
      if (/^P[FL]\d\d$/.test(key)) codeUse.add(num(r[key]));
    }
    const n = playerName(r);
    if (n.first.includes('<') || n.last.includes('<')) unknownCodes++;
    if (n.last.length > 0) {
      nonEmpty++;
      if (/^[A-Z]/.test(n.last)) capitalFirst++;
    }
  }
  const codesAbove52 = [...codeUse].filter((c) => c > 52).sort((a, b) => a - b);
  check(
    'names decode without unknown codes',
    unknownCodes === 0,
    `${unknownCodes} records contain codes > 52; codes seen above 52: [${codesAbove52.join(', ')}]`,
  );
  check(
    'last names start with a capital',
    capitalFirst / nonEmpty > 0.99,
    `${((capitalFirst / nonEmpty) * 100).toFixed(1)}% of ${nonEmpty} non-empty last names`,
  );

  // --- Physical plausibility -----------------------------------------------
  const heights = recs.map((r) => num(r.PHGT));
  const inRange = heights.filter((h) => h >= 64 && h <= 84).length;
  check(
    'PHGT is height in inches (64-84)',
    inRange / recs.length > 0.99,
    `${((inRange / recs.length) * 100).toFixed(1)}% in 5'4"-7'0"; min=${Math.min(...heights)} max=${Math.max(...heights)}`,
  );

  // The offset was unresolvable from the file alone -- both 160 and 165 gave
  // believable weights, so no internal test could separate them. It was settled
  // by reading one weight out of the game. This check pins that anchor so the
  // constant can never drift back to a guess.
  const ANCHOR = { first: 'Darius', last: 'Whitaker', jersey: 94, pos: 12, weight: 335 };
  const anchor = recs.find((r) => {
    const n = playerName(r);
    return n.first === ANCHOR.first && n.last === ANCHOR.last && num(r.PJEN) === ANCHOR.jersey;
  });
  check(
    'PWGT offset reproduces the in-game weight of a known player',
    anchor !== undefined && num(anchor.PWGT) + PLAYER_WEIGHT_OFFSET === ANCHOR.weight,
    anchor
      ? `${ANCHOR.first} ${ANCHOR.last} #${ANCHOR.jersey} ${PLAYER_POSITIONS[num(anchor.PPOS)]}: ` +
        `raw ${num(anchor.PWGT)} + ${PLAYER_WEIGHT_OFFSET} = ${num(anchor.PWGT) + PLAYER_WEIGHT_OFFSET} lb, ` +
        `game lists ${ANCHOR.weight} lb`
      : 'anchor player not found',
  );

  // Independently, the raw SPREAD must match a real weight range. This one
  // holds under any offset, so it validates the field without depending on the
  // constant.
  const rawWeights = recs.map((r) => num(r.PWGT));
  const rawSpread = Math.max(...rawWeights) - Math.min(...rawWeights);
  check(
    'PWGT spread matches a real weight range (~230 lb)',
    rawSpread >= 200 && rawSpread <= 255,
    `raw ${Math.min(...rawWeights)}..${Math.max(...rawWeights)}, spread ${rawSpread}; ` +
      `${Math.min(...rawWeights) + PLAYER_WEIGHT_OFFSET}-${Math.max(...rawWeights) + PLAYER_WEIGHT_OFFSET} lb`,
  );

  const jerseys = recs.map((r) => num(r.PJEN));
  check(
    'PJEN <= 99',
    jerseys.every((j) => j <= 99),
    `max jersey = ${Math.max(...jerseys)}`,
  );

  // --- Position distribution -----------------------------------------------
  const posCounts = new Map<number, number>();
  for (const r of recs) posCounts.set(num(r.PPOS), (posCounts.get(num(r.PPOS)) ?? 0) + 1);
  const positions = [...posCounts.keys()].sort((a, b) => a - b);
  console.log('\nPPOS histogram (119 FBS teams):');
  console.table(
    positions.map((p) => ({
      PPOS: p,
      count: posCounts.get(p),
      perTeam: ((posCounts.get(p) ?? 0) / 119).toFixed(2),
    })),
  );
  check(
    'PPOS spans a plausible position count',
    positions.length >= 14 && positions.length <= 24,
    `${positions.length} distinct positions (${positions[0]}..${positions[positions.length - 1]})`,
  );

  // --- Class year ----------------------------------------------------------
  const yearCounts = new Map<number, number>();
  for (const r of recs) yearCounts.set(num(r.PYER), (yearCounts.get(num(r.PYER)) ?? 0) + 1);
  console.log(
    '\nPYER distribution: ' +
      [...yearCounts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => `${k}:${v}`)
        .join(' '),
  );
  check(
    'PYER <= 5 (FR/SO/JR/SR + redshirt variants)',
    [...yearCounts.keys()].every((y) => y <= 5),
    `max class year = ${Math.max(...yearCounts.keys())}`,
  );

  // --- Primary key ---------------------------------------------------------
  const pgids = recs.map((r) => num(r.PGID));
  const distinctIds = new Set(pgids);
  check(
    'PGID is a primary key',
    distinctIds.size === recs.length,
    `${distinctIds.size} distinct across ${recs.length} records (min=${Math.min(...pgids)} max=${Math.max(...pgids)})`,
  );

  // --- Team derivation ------------------------------------------------------
  // PLAY has no TGID column. The team is encoded arithmetically in PGID:
  // each team owns a fixed block of TEAM_ROSTER_BLOCK (70) consecutive ids.
  // 70 is not a power of two, which is why every bit-shift hypothesis failed.
  const rosters = new Map<number, typeof recs>();
  for (const r of recs) {
    const t = playerTeam(num(r.PGID));
    const list = rosters.get(t);
    if (list) list.push(r);
    else rosters.set(t, [r]);
  }
  const sizes = [...rosters.values()].map((v) => v.length).sort((a, b) => a - b);
  check(
    'PGID partitions into fixed-size team blocks',
    sizes.every((s) => s <= TEAM_ROSTER_BLOCK),
    `${rosters.size} teams, roster sizes ${sizes[0]}..${sizes[sizes.length - 1]} ` +
      `(block size ${TEAM_ROSTER_BLOCK})`,
  );

  const slots = recs.map((r) => playerRosterSlot(num(r.PGID)));
  check(
    'roster slots are unique within each team',
    new Set(recs.map((r) => `${playerTeam(num(r.PGID))}:${playerRosterSlot(num(r.PGID))}`)).size ===
      recs.length,
    `max slot = ${Math.max(...slots)}`,
  );

  const team = loadTable(buf, toc, 'TEAM');
  const knownTgids = new Set(team.records.map((r) => num(r.TGID)));
  const orphans = [...rosters.keys()].filter((t) => !knownTgids.has(t));
  check(
    'every derived team id exists in TEAM.TGID',
    orphans.length === 0,
    orphans.length === 0
      ? `all ${rosters.size} derived ids found among ${knownTgids.size} TEAM rows ` +
        `(${knownTgids.size - rosters.size} teams carry no roster -- FCS schools)`
      : `orphans: ${orphans.slice(0, 10).join(', ')}`,
  );

  // A real roster fields nearly every position. Teams covering only a handful
  // would mean the block boundary is wrong.
  const thinRosters = [...rosters.entries()].filter(
    ([, list]) => new Set(list.map((r) => num(r.PPOS))).size < 18,
  );
  check(
    'every roster covers at least 18 of the 21 positions',
    thinRosters.length === 0,
    `${rosters.size - thinRosters.length}/${rosters.size} rosters well-formed ` +
      `(${PLAYER_POSITIONS.length} positions defined)`,
  );

  // --- Rating scale ---------------------------------------------------------
  // Ratings are a 5-bit index into a non-uniform quantisation of 40..99.
  // Round-tripping every representable raw value must be lossless.
  const roundTripBad = [...Array(32).keys()].filter(
    (raw) => displayToRating(ratingToDisplay(raw)) !== raw,
  );
  check(
    'rating scale round-trips for all 32 raw values',
    roundTripBad.length === 0,
    roundTripBad.length === 0
      ? `raw 0->${ratingToDisplay(0)} .. raw 31->${ratingToDisplay(31)}`
      : `failed for raw ${roundTripBad.join(', ')}`,
  );

  // Every rating in the file must land inside 0..31, or the bit widths are wrong.
  let outOfRange = 0;
  let maxDisplay = 0;
  for (const r of recs) {
    for (const f of RATING_FIELDS) {
      const v = num(r[f]);
      if (!Number.isFinite(v)) continue;
      if (v < 0 || v > 31) outOfRange++;
      maxDisplay = Math.max(maxDisplay, ratingToDisplay(v));
    }
  }
  check(
    'all rating fields hold a valid 0..31 index',
    outOfRange === 0,
    `${RATING_FIELDS.length} fields x ${recs.length} players; ` +
      `${outOfRange} out of range; best displayed rating = ${maxDisplay}`,
  );

  // --- Depth chart cross-join ----------------------------------------------
  // DCHT.PGID joins to PLAY.PGID by VALUE (not by row index).
  const dcht = loadTable(buf, toc, 'DCHT');
  const byPgid = new Map(recs.map((r) => [num(r.PGID), r]));
  const dchtIds = dcht.records.map((r) => num(r.PGID));
  const resolved = dchtIds.filter((v) => byPgid.has(v)).length;
  check(
    'every DCHT row resolves to a player',
    resolved === dchtIds.length,
    `${resolved}/${dchtIds.length} depth chart rows join to PLAY.PGID`,
  );

  // Positions should mostly agree. They do not agree perfectly because the
  // depth chart also lists special-teams roles (DCHT.PPOS values above PLAY's
  // 0..20 range, e.g. 22 = returner) for players whose listed position differs.
  let posMatch = 0;
  let specialTeams = 0;
  for (const d of dcht.records) {
    const p = byPgid.get(num(d.PGID));
    if (!p) continue;
    if (num(d.PPOS) > 20) specialTeams++;
    else if (num(p.PPOS) === num(d.PPOS)) posMatch++;
  }
  const comparable = dchtIds.length - specialTeams;
  check(
    'DCHT.PPOS agrees with PLAY.PPOS on non-special-teams rows',
    posMatch / comparable > 0.95,
    `${((posMatch / comparable) * 100).toFixed(1)}% of ${comparable} rows ` +
      `(${specialTeams} special-teams rows excluded)`,
  );

  // --- Rating names: position-profile test ---------------------------------
  // The rating names came from their mnemonics, which is a hint and not
  // evidence. The discriminating test is to state in advance which position a
  // correctly-named rating must peak at, then check. A mislabelled or swapped
  // field fails this; a merely plausible one does not survive it. PCTH/PCAR
  // are the one genuinely swappable pair, and this separates them.
  const posMean = (field: string, pos: number) => {
    const vals = recs.filter((r) => num(r.PPOS) === pos).map((r) => ratingToDisplay(num(r[field])));
    return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  };
  // PPOS: QB 0, HB 1, FB 2, WR 3, TE 4, LT-RT 5-9, LE 10, RE 11, DT 12,
  // LB 13-15, DB 16-18, K 19, P 20.
  const OL = [5, 6, 7, 8, 9];
  const profiles: { field: string; expect: number[]; why: string }[] = [
    { field: 'PSPD', expect: [1, 3, 16, 17, 18], why: 'speed peaks at HB/WR/DB' },
    { field: 'PACC', expect: [1, 3, 16, 17, 18], why: 'acceleration peaks at HB/WR/DB' },
    { field: 'PAGI', expect: [1, 3, 16, 17, 18], why: 'agility peaks at HB/WR/DB' },
    { field: 'PSTR', expect: OL, why: 'strength peaks on the offensive line' },
    { field: 'PCTH', expect: [3, 4], why: 'catching peaks at WR/TE, not HB' },
    { field: 'PCAR', expect: [1, 2], why: 'carrying peaks at HB/FB, not WR' },
    { field: 'PTHP', expect: [0], why: 'throw power peaks at QB' },
    { field: 'PTHA', expect: [0], why: 'throw accuracy peaks at QB' },
    { field: 'PKPR', expect: [19, 20], why: 'kick power peaks at K/P' },
    { field: 'PKAC', expect: [19, 20], why: 'kick accuracy peaks at K/P' },
    { field: 'PPBK', expect: OL, why: 'pass blocking peaks on the offensive line' },
    { field: 'PRBK', expect: OL, why: 'run blocking peaks on the offensive line' },
    { field: 'PTAK', expect: [12, 13, 14, 15], why: 'tackling peaks at DT/LB' },
  ];
  const profileResults = profiles.map((p) => {
    let bestPos = -1;
    let bestVal = -Infinity;
    for (let pos = 0; pos < PLAYER_POSITIONS.length; pos++) {
      const v = posMean(p.field, pos);
      if (v > bestVal) {
        bestVal = v;
        bestPos = pos;
      }
    }
    return { ...p, bestPos, ok: p.expect.includes(bestPos) };
  });
  const profilePasses = profileResults.filter((p) => p.ok);
  check(
    'each rating peaks at the position its name predicts',
    profilePasses.length === profiles.length,
    `${profilePasses.length}/${profiles.length}; ` +
      profileResults
        .map((p) => `${p.field}->${PLAYER_POSITIONS[p.bestPos]}${p.ok ? '' : ' (UNEXPECTED)'}`)
        .join(', '),
  );

  console.log('\n=== CHECKS ===');
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
  if (failed) process.exit(1);
}

main();
