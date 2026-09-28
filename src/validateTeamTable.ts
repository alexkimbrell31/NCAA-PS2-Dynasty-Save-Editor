/**
 * Validate the decoded TEAM table.
 *
 * As with PLAY, structural tiling proves nothing on its own. These checks are
 * semantic: they assert relationships that can only hold if the field mapping
 * is genuinely correct -- real rivalries, real conference alignments, real
 * stadium capacities.
 */

import {
  TEAM_PRESTIGE_MAX,
  TEAM_PRESTIGE_MIN,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  ratingToDisplay,
  readRecords,
  readSaveFile,
  teamName,
} from './lib/eadb.ts';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail: string) =>
  checks.push({ name, pass, detail });

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);
const str = (v: number | string) => (typeof v === 'string' ? v : '');

function load(buf: Buffer, toc: ReturnType<typeof parseToc>, name: string) {
  const e = findTable(toc, name);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { header: h, fields: f, records: readRecords(buf, h, f) };
}

/** Rivalries that must hold in any faithful 2006 roster. */
const KNOWN_RIVALRIES: Array<[string, string]> = [
  ['Ohio State', 'Michigan'],
  ['Michigan', 'Ohio State'],
  ['Army', 'Navy'],
  ['Navy', 'Army'],
  ['Alabama', 'Auburn'],
  ['Auburn', 'Alabama'],
  ['Texas', 'Texas A&M'],
  ['USC', 'UCLA'],
  ['Florida', 'Florida State'],
  ['Georgia', 'Georgia Tech'],
  ['Oregon', 'Oregon State'],
  ['Clemson', 'South Carolina'],
];

/** SEC East and West as they stood in 2006. */
const SEC_EAST = ['Florida', 'Georgia', 'Kentucky', 'South Carolina', 'Tennessee', 'Vanderbilt'];
const SEC_WEST = ['Alabama', 'Arkansas', 'Auburn', 'LSU', 'Mississippi State', 'Ole Miss'];

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));

  const team = load(buf, toc, 'TEAM');
  const play = load(buf, toc, 'PLAY');
  const conf = load(buf, toc, 'CONF');
  const stad = load(buf, toc, 'STAD');
  const recs = team.records;

  console.log(`TEAM: ${recs.length} records, ${team.fields.length} fields\n`);

  const byName = new Map(recs.map((r) => [str(r.TDNA), r]));
  const nameByTgid = new Map(recs.map((r) => [num(r.TGID), str(r.TDNA)]));

  // --- Structure ------------------------------------------------------------
  const sorted = [...team.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  let gaps = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) gaps++;
    cursor += f.bits;
  }
  check(
    'fields tile the record with no gaps or overlaps',
    gaps === 0,
    `bits 0..${cursor - 1} of ${team.header.recordLenBytes * 8}`,
  );

  // --- Identity -------------------------------------------------------------
  const tgids = recs.map((r) => num(r.TGID));
  check(
    'TGID is a primary key',
    new Set(tgids).size === recs.length,
    `${new Set(tgids).size} distinct (min ${Math.min(...tgids)}, max ${Math.max(...tgids)})`,
  );
  check(
    'every team has a school name',
    recs.every((r) => str(r.TDNA).length > 0),
    `${recs.filter((r) => str(r.TMNA).length > 0).length}/${recs.length} also have a nickname`,
  );

  // --- Roster link ----------------------------------------------------------
  const rostered = new Set([...play.records].map((p) => playerTeam(num(p.PGID))));
  const fbs = recs.filter((r) => rostered.has(num(r.TGID)));
  check(
    'TTYP separates FBS from FCS exactly as the roster split does',
    fbs.every((r) => num(r.TTYP) === 0) &&
      recs.filter((r) => !rostered.has(num(r.TGID))).every((r) => num(r.TTYP) === 1),
    `TTYP=0 for all ${fbs.length} rostered teams, TTYP=1 for all ${recs.length - fbs.length} others`,
  );

  // --- Conference -----------------------------------------------------------
  const confName = new Map(conf.records.map((c) => [num(c.CGID), str(c.CNAM)]));
  check(
    'every team resolves to a conference',
    recs.every((r) => confName.has(num(r.CGID))),
    `${new Set(recs.map((r) => num(r.CGID))).size} conferences in use`,
  );

  const secId = [...confName.entries()].find(([, n]) => n === 'SEC')?.[0];
  const sec = recs.filter((r) => num(r.CGID) === secId);
  const secDivs = new Map<number, string[]>();
  for (const r of sec) {
    const d = num(r.DGID);
    if (!secDivs.has(d)) secDivs.set(d, []);
    secDivs.get(d)!.push(str(r.TDNA));
  }
  const divMatches = [...secDivs.values()].filter((names) => {
    const s = [...names].sort().join('|');
    return s === [...SEC_EAST].sort().join('|') || s === [...SEC_WEST].sort().join('|');
  }).length;
  check(
    'DGID reproduces the 2006 SEC East/West split',
    divMatches === 2,
    `${sec.length} SEC teams in ${secDivs.size} divisions; ${divMatches}/2 match exactly`,
  );

  // --- Rivalries ------------------------------------------------------------
  const rivalHits = KNOWN_RIVALRIES.filter(([a, b]) => {
    const r = byName.get(a);
    return r && nameByTgid.get(num(r.TMRV)) === b;
  });
  check(
    'TMRV reproduces known rivalries',
    rivalHits.length === KNOWN_RIVALRIES.length,
    `${rivalHits.length}/${KNOWN_RIVALRIES.length} correct ` +
      `(e.g. ${rivalHits.slice(0, 3).map(([a, b]) => `${a}->${b}`).join(', ')})`,
  );
  const mutual = recs.filter((r) => {
    const o = recs.find((x) => num(x.TGID) === num(r.TMRV));
    return o && num(o.TMRV) === num(r.TGID);
  }).length;
  check(
    'rivalries are mostly symmetric',
    mutual / recs.length > 0.5,
    `${mutual}/${recs.length} teams are their rival's rival`,
  );

  // --- Prestige -------------------------------------------------------------
  const prestige = recs.map((r) => num(r.TMPR));
  check(
    'TMPR is a 1-6 prestige rating',
    prestige.every((v) => v >= TEAM_PRESTIGE_MIN && v <= TEAM_PRESTIGE_MAX),
    `range ${Math.min(...prestige)}..${Math.max(...prestige)}`,
  );
  const sixStar = fbs.filter((r) => num(r.TMPR) === 6).map((r) => str(r.TDNA));
  const expectedSix = ['Ohio State', 'Michigan', 'Texas', 'USC', 'Oklahoma', 'Florida', 'LSU', 'Notre Dame', 'Miami', 'Tennessee'];
  const sixHits = expectedSix.filter((n) => sixStar.includes(n)).length;
  check(
    '6-star prestige is limited to blue-blood programs',
    sixHits >= 9 && sixStar.length <= 15,
    `${sixStar.length} teams at 6 stars; ${sixHits}/${expectedSix.length} expected powers present`,
  );

  // --- Academics ------------------------------------------------------------
  const topAcademic = fbs.filter((r) => num(r.TMAR) === 6).map((r) => str(r.TDNA));
  const expectedAcademic = ['Stanford', 'Duke', 'Northwestern'];
  check(
    'TMAR is an academic rating, not athletic',
    expectedAcademic.every((n) => topAcademic.includes(n)),
    `top academics: ${topAcademic.join(', ')}`,
  );

  // --- Stadium --------------------------------------------------------------
  const stadIds = new Set(stad.records.map((s) => num(s.SGID)));
  check(
    'every FBS team resolves to a stadium',
    fbs.every((r) => stadIds.has(num(r.SGID))),
    `${stad.records.length} stadiums defined`,
  );

  // TMAA is AVERAGE ATTENDANCE, not capacity. This was mislabelled until the
  // STAD table was decoded: STAD.SCAP holds the real capacity and matches
  // published 2006 figures exactly, while TMAA disagrees with it on all 119
  // teams. TMAA's real-world ordering (Michigan > Penn State > Tennessee) is
  // produced by attendance just as well as by capacity, so that ordering never
  // discriminated between the two readings.
  const stadByGid = new Map(stad.records.map((r) => [num(r.SGID), r]));
  const attendance = fbs.map((r) => num(r.TMAA));
  const biggest = [...fbs].sort((a, b) => num(b.TMAA) - num(a.TMAA))[0];
  const smallest = [...fbs].sort((a, b) => num(a.TMAA) - num(b.TMAA))[0];
  check(
    'TMAA is a plausible average attendance',
    attendance.every((c) => c >= 5000 && c <= 115000),
    `${str(smallest.TDNA)} ${num(smallest.TMAA).toLocaleString()} .. ` +
      `${str(biggest.TDNA)} ${num(biggest.TMAA).toLocaleString()}`,
  );

  // Attendance is bounded by the building. A handful of programs exceed listed
  // capacity because standing room is not counted, but nobody draws double.
  const fill = fbs
    .map((r) => {
      const st = stadByGid.get(num(r.SGID));
      return st ? num(r.TMAA) / num(st.SCAP) : NaN;
    })
    .filter((v) => !Number.isNaN(v));
  check(
    'attendance never meaningfully exceeds stadium capacity',
    fill.every((f) => f <= 1.1),
    `fill rate ${(Math.min(...fill) * 100).toFixed(0)}%..${(Math.max(...fill) * 100).toFixed(0)}%, ` +
      `${fill.filter((f) => f > 1).length} teams above 100% (standing room)`,
  );

  // The decisive discriminator: attendance tracks how good a program is, but a
  // stadium's capacity is a property of the building and would not.
  const tiers = [1, 2, 3, 4, 5, 6].map((p) => {
    const rows = fbs.filter((r) => num(r.TMPR) === p);
    const fr = rows
      .map((r) => {
        const st = stadByGid.get(num(r.SGID));
        return st ? num(r.TMAA) / num(st.SCAP) : NaN;
      })
      .filter((v) => !Number.isNaN(v));
    return fr.reduce((a, b) => a + b, 0) / (fr.length || 1);
  });
  check(
    'fill rate rises monotonically with program prestige',
    tiers.every((v, i) => i === 0 || v >= tiers[i - 1]),
    tiers.map((v, i) => `${i + 1}-star ${(v * 100).toFixed(0)}%`).join(', '),
  );

  // The five "1AA <region>" rows are generic filler opponents, not real
  // programs: no stadium, no roster.
  const placeholders = recs.filter((r) => /^1AA /.test(str(r.TDNA)));
  check(
    'placeholder 1AA opponents are the only teams without an attendance figure',
    recs.filter((r) => num(r.TMAA) === 0).length === placeholders.length,
    `${placeholders.length} placeholders: ${placeholders.map((r) => str(r.TDNA)).join(', ')}`,
  );
  check(
    'Michigan draws the largest crowds',
    str(biggest.TDNA) === 'Michigan',
    `${str(biggest.TDNA)} at ${num(biggest.TMAA).toLocaleString()} per game`,
  );

  // --- Team ratings ---------------------------------------------------------
  const ovr = fbs.map((r) => num(r.TROV));
  check(
    'TROV is a 0-99 team overall',
    ovr.every((v) => v >= 40 && v <= 99),
    `range ${Math.min(...ovr)}..${Math.max(...ovr)}`,
  );

  // --- Unit ratings: the discriminating test -------------------------------
  // Correlating a unit rating against overall roster strength proves nothing --
  // every unit rating does that, so such a test cannot tell TRQB from TRRB.
  // The test that CAN fail is: each unit rating must correlate better with its
  // OWN position group than with any other group. A swapped or mislabelled
  // field loses that contest.
  const corr = (a: number[], b: number[]) => {
    const n = a.length;
    const ma = a.reduce((x, y) => x + y, 0) / n;
    const mb = b.reduce((x, y) => x + y, 0) / n;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - ma;
      const db = b[i] - mb;
      sab += da * db;
      saa += da * da;
      sbb += db * db;
    }
    return sab / Math.sqrt(saa * sbb);
  };

  // PPOS groups: QB 0, RB 1-2, WR 3-4, OL 5-9, DL 10-12, LB 13-15, DB 16-18.
  const units: { field: string; label: string; pos: number[] }[] = [
    { field: 'TRQB', label: 'quarterbacks', pos: [0] },
    { field: 'TRRB', label: 'running backs', pos: [1, 2] },
    { field: 'TWRR', label: 'receivers', pos: [3, 4] },
    { field: 'TROL', label: 'offensive line', pos: [5, 6, 7, 8, 9] },
    { field: 'TRDL', label: 'defensive line', pos: [10, 11, 12] },
    { field: 'TRLB', label: 'linebackers', pos: [13, 14, 15] },
    { field: 'TRDB', label: 'defensive backs', pos: [16, 17, 18] },
  ];

  // Mean displayed overall of each team's players in each unit.
  const unitStrength = new Map<string, Map<number, number>>();
  for (const u of units) {
    const want = new Set(u.pos);
    const byTeam = new Map<number, number[]>();
    for (const p of play.records) {
      if (!want.has(num(p.PPOS))) continue;
      const tid = playerTeam(num(p.PGID));
      if (!byTeam.has(tid)) byTeam.set(tid, []);
      byTeam.get(tid)!.push(ratingToDisplay(num(p.POVR)));
    }
    unitStrength.set(
      u.field,
      new Map([...byTeam].map(([t, v]) => [t, v.reduce((a, b) => a + b, 0) / v.length])),
    );
  }

  const withRoster = fbs.filter((r) => units.every((u) => unitStrength.get(u.field)!.has(num(r.TGID))));
  const unitResults = units.map((u) => {
    const scores = units.map((other) => {
      const s = unitStrength.get(other.field)!;
      return {
        label: other.label,
        r: corr(
          withRoster.map((t) => num(t[u.field])),
          withRoster.map((t) => s.get(num(t.TGID))!),
        ),
      };
    });
    const own = scores.find((s) => s.label === u.label)!.r;
    const bestOther = Math.max(...scores.filter((s) => s.label !== u.label).map((s) => s.r));
    return { field: u.field, own, bestOther };
  });
  const unitWins = unitResults.filter((u) => u.own > u.bestOther);
  check(
    'each unit rating correlates best with its own position group',
    unitWins.length === units.length,
    `${unitWins.length}/${units.length} across ${withRoster.length} teams; ` +
      unitResults
        .map((u) => `${u.field} ${u.own.toFixed(3)} vs ${u.bestOther.toFixed(3)}`)
        .join(', '),
  );

  // TMPR and TMAR must be independent quantities, not two views of one number:
  // program prestige should predict on-field strength and academic prestige
  // should largely not.
  const rPrestigeOvr = corr(
    fbs.map((r) => num(r.TMPR)),
    ovr,
  );
  const rAcademicOvr = corr(
    fbs.map((r) => num(r.TMAR)),
    ovr,
  );
  check(
    'TMPR predicts team strength but TMAR does not',
    rPrestigeOvr > 0.6 && rAcademicOvr < 0.5 && rPrestigeOvr - rAcademicOvr > 0.3,
    `corr(TMPR,TROV)=${rPrestigeOvr.toFixed(3)} vs corr(TMAR,TROV)=${rAcademicOvr.toFixed(3)}; ` +
      `corr(TMPR,TMAR)=${corr(
        fbs.map((r) => num(r.TMPR)),
        fbs.map((r) => num(r.TMAR)),
      ).toFixed(3)}`,
  );

  console.log('=== CHECKS ===');
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
  if (failed) process.exit(1);
}

main();
