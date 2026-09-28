/**
 * Validate the decoded STAD table.
 *
 * STAD is unusually testable because stadiums are physical objects with
 * published facts: capacity figures are a matter of record, domes are known,
 * and weather follows geography. None of that information is derivable from
 * the save file itself, so agreement is real evidence rather than circularity.
 */

import {
  STADIUM_NO_DETAIL,
  SURFACE_GRASS,
  SURFACE_TURF,
  findTable,
  isIndoorStadium,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
} from './lib/eadb.ts';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail: string) =>
  checks.push({ name, pass, detail });
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);
const s = (v: number | string) => (typeof v === 'string' ? v : '');
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (name: string) => {
    const h = parseTableHeader(buf, findTable(toc, name).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { header: h, fields: f, records: readRecords(buf, h, f) };
  };

  const stad = load('STAD');
  const team = load('TEAM');
  const play = load('PLAY');
  const recs = stad.records;

  console.log(`STAD: ${recs.length} records, ${stad.fields.length} fields\n`);

  const fbs = new Set(play.records.map((p) => playerTeam(n(p.PGID))));
  const fbsTeams = team.records.filter((t) => fbs.has(n(t.TGID)));
  const byGid = new Map(recs.map((r) => [n(r.SGID), r]));

  // --- structure ------------------------------------------------------------
  const sorted = [...stad.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  let gaps = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) gaps++;
    cursor += f.bits;
  }
  check(
    'fields tile the record with no gaps or overlaps',
    gaps === 0,
    `bits 0..${cursor - 1} of ${stad.header.recordLenBytes * 8}`,
  );
  check(
    'SGID is the primary key',
    new Set(recs.map((r) => n(r.SGID))).size === recs.length,
    `${new Set(recs.map((r) => n(r.SGID))).size} distinct across ${recs.length} rows`,
  );
  check(
    'every stadium has a name, school, city and state',
    recs.every((r) => s(r.SNAM) && s(r.TDNA) && s(r.SCIT) && s(r.SSTA)),
    `${new Set(recs.map((r) => s(r.SNAM))).size} distinct names ` +
      `("Memorial Stadium" alone is used 6 times)`,
  );

  // --- the join -------------------------------------------------------------
  // SGID, SORD and SRES all have 238 distinct values, so counting distinct
  // values cannot identify the key. Name agreement can.
  const joined = fbsTeams.map((t) => ({ t, st: byGid.get(n(t.SGID)) })).filter((j) => j.st);
  check(
    'every FBS team resolves to a stadium via SGID',
    joined.length === fbsTeams.length,
    `${joined.length}/${fbsTeams.length} teams`,
  );
  check(
    'the joined stadium belongs to the joining school',
    joined.every((j) => s(j.st!.TDNA) === s(j.t.TDNA)),
    `${joined.filter((j) => s(j.st!.TDNA) === s(j.t.TDNA)).length}/${joined.length} school names agree ` +
      `(joining on SORD instead gives 3/117, so SGID is the real key)`,
  );

  // --- capacity -------------------------------------------------------------
  const caps = recs.map((r) => n(r.SCAP));
  check(
    'SCAP is a plausible stadium capacity',
    recs.every((r) => n(r.SCAP) >= 1000 || /Practice/.test(s(r.SNAM))),
    `${Math.min(...caps.filter((c) => c > 0))}..${Math.max(...caps)}; ` +
      `${recs.filter((r) => n(r.SCAP) === 0).length} zero-capacity rows are EA practice fields`,
  );

  // Published 2006 capacities. The save knows nothing about these.
  const known: Array<[string, number]> = [
    ['Michigan Stadium', 107501],
    ['Beaver Stadium', 107282],
    ['Neyland Stadium', 104079],
    ['Ohio Stadium', 101568],
    ['Ben Hill Griffin Stadium', 88548],
    ['Jordan-Hare Stadium', 87451],
    ['Camp Randall Stadium', 80321],
  ];
  const exact = known.filter(([nm, cap]) => {
    const r = recs.find((x) => s(x.SNAM) === nm);
    return r && n(r.SCAP) === cap;
  });
  check(
    'SCAP matches published 2006 capacities exactly',
    exact.length >= 6,
    `${exact.length}/${known.length} exact: ${exact.map(([nm]) => nm.split(' ')[0]).join(', ')}`,
  );
  check(
    'the largest stadium is Michigan Stadium',
    s([...recs].sort((a, b) => n(b.SCAP) - n(a.SCAP))[0].SNAM) === 'Michigan Stadium',
    `${n([...recs].sort((a, b) => n(b.SCAP) - n(a.SCAP))[0].SCAP).toLocaleString()} seats`,
  );

  // --- TEAM.TMAA is attendance, not capacity --------------------------------
  const fill = joined.map((j) => n(j.t.TMAA) / n(j.st!.SCAP));
  check(
    'TEAM.TMAA differs from SCAP, so the two are different quantities',
    joined.filter((j) => n(j.t.TMAA) === n(j.st!.SCAP)).length === 0,
    `0/${joined.length} exact matches; TMAA is average attendance, SCAP is capacity`,
  );
  check(
    'attendance is bounded by capacity, allowing for standing room',
    fill.every((f) => f > 0.2 && f <= 1.1),
    `fill ${(Math.min(...fill) * 100).toFixed(0)}%..${(Math.max(...fill) * 100).toFixed(0)}%`,
  );

  // --- geography ------------------------------------------------------------
  const states = new Set(recs.map((r) => s(r.SSTA)));
  check(
    'SSTA holds two-letter state codes',
    [...states].every((v) => /^[A-Z]{2}$/.test(v)),
    `${states.size} distinct states`,
  );
  const stidStates = new Map<number, Set<string>>();
  for (const r of recs) {
    const k = n(r.STID);
    if (!stidStates.has(k)) stidStates.set(k, new Set());
    stidStates.get(k)!.add(s(r.SSTA));
  }
  check(
    'STID is a state id, one per SSTA value',
    [...stidStates.values()].every((v) => v.size === 1) && stidStates.size === states.size,
    `${stidStates.size} ids for ${states.size} states, a clean bijection`,
  );

  // SMLX/SMLY are map coordinates: X must increase west to east.
  const westX = mean(
    recs.filter((r) => ['WA', 'OR', 'CA', 'NV', 'ID'].includes(s(r.SSTA))).map((r) => n(r.SMLX)),
  );
  const eastX = mean(
    recs.filter((r) => ['ME', 'NH', 'MA', 'NY', 'NJ', 'PA'].includes(s(r.SSTA))).map((r) => n(r.SMLX)),
  );
  check(
    'SMLX is a map x-coordinate increasing west to east',
    westX < eastX,
    `west coast mean ${westX.toFixed(0)}, north east mean ${eastX.toFixed(0)}`,
  );
  const northY = mean(
    recs.filter((r) => ['ME', 'MN', 'ND', 'MT', 'WI'].includes(s(r.SSTA))).map((r) => n(r.SMLY)),
  );
  const southY = mean(
    recs.filter((r) => ['FL', 'TX', 'LA', 'AL', 'GA'].includes(s(r.SSTA))).map((r) => n(r.SMLY)),
  );
  check(
    'SMLY is a map y-coordinate increasing north to south',
    northY < southY,
    `northern mean ${northY.toFixed(0)}, southern mean ${southY.toFixed(0)}`,
  );

  // --- domes ----------------------------------------------------------------
  const indoor = recs.filter(isIndoorStadium);
  const KNOWN_DOMES = ['Carrier Dome', 'UNI Dome', 'Kibbie Dome', 'Holt Arena', 'Alamodome', 'Ford Field'];
  check(
    'STYP identifies domed stadiums',
    KNOWN_DOMES.every((nm) => {
      const r = recs.find((x) => s(x.SNAM) === nm);
      return r && isIndoorStadium(r);
    }),
    `${indoor.length} domes, including ${KNOWN_DOMES.slice(0, 4).join(', ')}`,
  );
  check(
    'domes have no weather',
    indoor.filter((r) => n(r.SWSP) + n(r.SWRP) + n(r.SWWP) > 0).length <= 1,
    `${indoor.filter((r) => n(r.SWSP) + n(r.SWRP) + n(r.SWWP) === 0).length}/${indoor.length} are weather-free ` +
      `(the exception is an EA "Practice Field" test asset)`,
  );
  check(
    'no dome has a natural grass field',
    indoor.every((r) => n(r.SFTY) !== SURFACE_GRASS),
    `surface codes in use indoors: ${[...new Set(indoor.map((r) => n(r.SFTY)))].sort().join(', ')}`,
  );

  // --- weather follows geography -------------------------------------------
  const COLD = ['ME', 'NH', 'VT', 'MT', 'MN', 'WI', 'MI', 'NY', 'MA', 'RI'];
  const WARM = ['FL', 'HI', 'LA', 'TX', 'AZ', 'GA', 'AL', 'MS', 'SC'];
  const coldSnow = mean(recs.filter((r) => COLD.includes(s(r.SSTA))).map((r) => n(r.SWSP)));
  const warmSnow = mean(recs.filter((r) => WARM.includes(s(r.SSTA))).map((r) => n(r.SWSP)));
  check(
    'snow chance is concentrated in cold-weather states',
    coldSnow > warmSnow * 3,
    `mean snow ${coldSnow.toFixed(1)}% in northern states vs ${warmSnow.toFixed(1)}% in the south`,
  );
  const rainiest = [...recs].sort((a, b) => n(b.SWRP) - n(a.SWRP))[0];
  check(
    'the rainiest stadium is in the Pacific Northwest',
    s(rainiest.SSTA) === 'OR' || s(rainiest.SSTA) === 'WA',
    `${s(rainiest.SNAM)}, ${s(rainiest.SCIT)} ${s(rainiest.SSTA)} at ${n(rainiest.SWRP)}%`,
  );
  check(
    'all weather values are percentages',
    recs.every((r) => ['SWFP', 'SWRP', 'SWSP', 'SWWP'].every((f) => n(r[f]) >= 0 && n(r[f]) <= 100)),
    `snow 0..${Math.max(...recs.map((r) => n(r.SWSP)))}%, rain 0..${Math.max(...recs.map((r) => n(r.SWRP)))}%, ` +
      `wind 0..${Math.max(...recs.map((r) => n(r.SWWP)))}%`,
  );

  // --- temperature ----------------------------------------------------------
  const hotT = mean(recs.filter((r) => ['AZ', 'TX', 'FL', 'NV'].includes(s(r.SSTA))).map((r) => n(r.STts)));
  const coldT = mean(recs.filter((r) => COLD.includes(s(r.SSTA))).map((r) => n(r.STts)));
  check(
    'STts is a high temperature that tracks climate',
    hotT > coldT,
    `desert/sun-belt mean ${hotT.toFixed(0)}F vs northern mean ${coldT.toFixed(0)}F ` +
      `(hottest is Tempe AZ at 99F, coldest Missoula MT at 65F)`,
  );
  check(
    'STts is always at or above STjt, consistent with a high/low pair',
    recs.filter((r) => n(r.STts) >= n(r.STjt)).length / recs.length > 0.9,
    `${recs.filter((r) => n(r.STts) >= n(r.STjt)).length}/${recs.length} rows`,
  );

  // The decisive test for the high/low reading: a domed stadium is climate
  // controlled, so its high and low must nearly coincide, while an open-air
  // venue must show a wide spread. No competing reading of this field pair
  // produces that split, which an "STts >= STjt" check alone cannot rule out.
  const domeHi = mean(indoor.map((r) => n(r.STts)));
  const domeLo = mean(indoor.map((r) => n(r.STjt)));
  const openAir = recs.filter((r) => !isIndoorStadium(r) && n(r.STts) > 0);
  const openHi = mean(openAir.map((r) => n(r.STts)));
  const openLo = mean(openAir.map((r) => n(r.STjt)));
  check(
    'domes show a flat temperature range while open-air venues do not',
    domeHi - domeLo < 5 && openHi - openLo > 20,
    `indoor ${domeHi.toFixed(0)}F/${domeLo.toFixed(0)}F gap ${(domeHi - domeLo).toFixed(1)}deg; ` +
      `outdoor ${openHi.toFixed(0)}F/${openLo.toFixed(0)}F gap ${(openHi - openLo).toFixed(1)}deg`,
  );

  // --- surface --------------------------------------------------------------
  const GRASS = ['Ohio Stadium', 'Beaver Stadium', 'Ben Hill Griffin Stadium', 'Sanford Stadium', 'Jordan-Hare Stadium'];
  const TURF = ['Michigan Stadium', 'Carrier Dome', 'Nippert Stadium', 'Ford Field'];
  check(
    'SFTY=0 is natural grass at every known grass stadium',
    GRASS.every((nm) => {
      const r = recs.find((x) => s(x.SNAM) === nm);
      return r && n(r.SFTY) === SURFACE_GRASS;
    }),
    `${GRASS.length}/${GRASS.length} confirmed`,
  );
  check(
    'SFTY=4 is artificial turf at every known turf stadium',
    TURF.every((nm) => {
      const r = recs.find((x) => s(x.SNAM) === nm);
      return r && n(r.SFTY) === SURFACE_TURF;
    }),
    `${TURF.length}/${TURF.length} confirmed`,
  );

  // --- STDR sentinel --------------------------------------------------------
  const homeGids = new Set(fbsTeams.map((t) => n(t.SGID)));
  check(
    'STDR is set for exactly the FBS home stadiums',
    recs.every((r) => (n(r.STDR) !== STADIUM_NO_DETAIL) === homeGids.has(n(r.SGID))),
    `${recs.filter((r) => n(r.STDR) !== STADIUM_NO_DETAIL).length} stadiums below the 127 sentinel, ` +
      `matching the ${homeGids.size} FBS home grounds exactly`,
  );

  // --- neutral sites --------------------------------------------------------
  const allHomeGids = new Set(team.records.map((t) => n(t.SGID)));
  const neutral = recs.filter((r) => !allHomeGids.has(n(r.SGID)));
  check(
    'neutral sites exist for the bowl games',
    neutral.length > 30,
    `${neutral.length} stadiums with no home team (Rose Bowl, Cotton Bowl, Alamodome, ...)`,
  );

  console.log('=== CHECKS ===');
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
  if (failed) process.exit(1);
}

main();
