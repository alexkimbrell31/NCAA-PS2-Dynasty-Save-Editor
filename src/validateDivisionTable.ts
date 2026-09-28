/**
 * Validate the decoded DIVI table.
 *
 * DIVI is the only table so far that is largely self-validating: `DNAM` is
 * plain text of the form "<Conference> (<Division>)", so the row states its own
 * conference in words and we can check that against the numeric `CGID` without
 * appealing to any outside fact.
 *
 * That makes DIVI the right place to finally prove `TEAM.DGID` is a division
 * foreign key rather than, say, a region or a schedule bucket -- and to prove
 * 15 is a sentinel rather than an eleventh division.
 */

import {
  DIVISION_NONE,
  findTable,
  hasDivision,
  isConferenceChampionship,
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

/**
 * The real 2006 divisional alignments. Every one of these five conferences
 * split into two six-team divisions that season, and the memberships below are
 * public record.
 */
const ALIGNMENT_2006: Record<string, string[]> = {
  'Big 12 (North)': ['Colorado', 'Iowa State', 'Kansas', 'Kansas State', 'Missouri', 'Nebraska'],
  'Big 12 (South)': ['Baylor', 'Oklahoma', 'Oklahoma State', 'Texas', 'Texas A&M', 'Texas Tech'],
  'MAC (East)': ['Akron', 'Bowling Green', 'Buffalo', 'Kent State', 'Miami University', 'Ohio'],
  'MAC (West)': [
    'Ball State',
    'Central Michigan',
    'Eastern Michigan',
    'Northern Illinois',
    'Toledo',
    'Western Michigan',
  ],
  'SEC (East)': ['Florida', 'Georgia', 'Kentucky', 'South Carolina', 'Tennessee', 'Vanderbilt'],
  'SEC (West)': ['Alabama', 'Arkansas', 'Auburn', 'LSU', 'Mississippi State', 'Ole Miss'],
  'ACC (Atlantic)': [
    'Boston College',
    'Clemson',
    'Florida State',
    'Maryland',
    'NC State',
    'Wake Forest',
  ],
  'ACC (Coastal)': [
    'Duke',
    'Georgia Tech',
    'Miami',
    'North Carolina',
    'Virginia',
    'Virginia Tech',
  ],
  'C-USA (East)': ['ECU', 'Marshall', 'Memphis', 'Southern Miss', 'UAB', 'UCF'],
  'C-USA (West)': ['Houston', 'Rice', 'SMU', 'Tulane', 'Tulsa', 'UTEP'],
};

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (name: string) => {
    const h = parseTableHeader(buf, findTable(toc, name).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { header: h, fields: f, records: readRecords(buf, h, f) };
  };

  const divi = load('DIVI');
  const conf = load('CONF');
  const team = load('TEAM');
  const bowl = load('BOWL');
  const play = load('PLAY');
  const rows = divi.records;

  console.log(`DIVI: ${rows.length} records, ${divi.fields.length} fields\n`);

  const confName = new Map(conf.records.map((r) => [n(r.CGID), s(r.CNAM)]));
  const byDgid = new Map(rows.map((r) => [n(r.DGID), r]));

  // --- structure ------------------------------------------------------------
  const sorted = [...divi.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  let tiles = true;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) tiles = false;
    cursor += f.bits;
  }
  check(
    'fields tile the record with no gaps or overlaps',
    tiles,
    `${sorted.length} fields cover bits 0..${cursor - 1} of ${divi.header.recordLenBytes * 8}`,
  );
  check(
    'table is exactly full',
    divi.header.currentRecords === divi.header.maxRecords,
    `${divi.header.currentRecords}/${divi.header.maxRecords} records used`,
  );

  // --- DGID is the primary key ---------------------------------------------
  const dgids = rows.map((r) => n(r.DGID)).sort((a, b) => a - b);
  check(
    'DGID is a dense primary key 0..9',
    new Set(dgids).size === rows.length && dgids.every((d, i) => d === i),
    `${new Set(dgids).size} distinct values, ${dgids[0]}..${dgids[dgids.length - 1]}`,
  );

  // --- DNAM validates CGID without outside knowledge ------------------------
  // This is the strong one: the row spells its conference out in text, so the
  // numeric CGID has an independent witness inside the same record.
  const parsed = rows.map((r) => {
    const m = /^(.+) \((.+)\)$/.exec(s(r.DNAM));
    return { rec: r, conf: m?.[1] ?? '', half: m?.[2] ?? '', ok: Boolean(m) };
  });
  check(
    'every DNAM has the form "<Conference> (<Division>)"',
    parsed.every((p) => p.ok),
    parsed.every((p) => p.ok)
      ? `all ${rows.length}: ${parsed.map((p) => p.half).join(', ')}`
      : `failed on ${parsed.filter((p) => !p.ok).map((p) => s(p.rec.DNAM)).join(', ')}`,
  );
  const nameAgrees = parsed.filter((p) => p.conf === confName.get(n(p.rec.CGID)));
  check(
    "DNAM's spelled-out conference matches CONF.CNAM for the row's CGID",
    nameAgrees.length === rows.length,
    `${nameAgrees.length}/${rows.length} agree — CGID is independently witnessed by text`,
  );

  // --- five conferences, two divisions each ---------------------------------
  const perConf = new Map<number, number>();
  for (const r of rows) perConf.set(n(r.CGID), (perConf.get(n(r.CGID)) ?? 0) + 1);
  check(
    'exactly five conferences split, each into exactly two divisions',
    perConf.size === 5 && [...perConf.values()].every((v) => v === 2),
    `${perConf.size} conferences: ${[...perConf.keys()]
      .map((c) => confName.get(c) ?? `#${c}`)
      .join(', ')}`,
  );
  check(
    'the two halves of a conference are distinct',
    [...perConf.keys()].every((c) => {
      const halves = parsed.filter((p) => n(p.rec.CGID) === c).map((p) => p.half);
      return new Set(halves).size === 2;
    }),
    [...perConf.keys()]
      .map(
        (c) =>
          `${confName.get(c)}: ${parsed
            .filter((p) => n(p.rec.CGID) === c)
            .map((p) => p.half)
            .join('/')}`,
      )
      .join(', '),
  );

  // --- TEAM.DGID is a foreign key into DIVI ---------------------------------
  const divided = team.records.filter(hasDivision);
  check(
    'every non-sentinel TEAM.DGID resolves to a DIVI row',
    divided.every((t) => byDgid.has(n(t.DGID))),
    `${divided.length} teams resolve; ` +
      `${new Set(divided.map((t) => n(t.DGID))).size}/${rows.length} divisions are occupied`,
  );
  const sizes = new Map<number, number>();
  for (const t of divided) sizes.set(n(t.DGID), (sizes.get(n(t.DGID)) ?? 0) + 1);
  check(
    'every division holds exactly six teams',
    [...sizes.values()].every((v) => v === 6),
    `sizes: ${[...sizes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .join(',')} (${divided.length} teams in 10 divisions)`,
  );

  // The discriminating test for "division" vs any other grouping: a team's
  // division must belong to the team's own conference. A region or a schedule
  // bucket would not have to.
  const confMatches = divided.filter(
    (t) => n(t.CGID) === n(byDgid.get(n(t.DGID))!.CGID),
  );
  check(
    "each team's division belongs to that team's own conference",
    confMatches.length === divided.length,
    `${confMatches.length}/${divided.length} — rules out DGID being a region or a pod`,
  );

  // --- 15 is a sentinel, not a division -------------------------------------
  const undivided = team.records.filter((t) => !hasDivision(t));
  const undividedConfs = new Set(undivided.map((t) => n(t.CGID)));
  check(
    `DGID ${DIVISION_NONE} is a sentinel, not an eleventh division`,
    !byDgid.has(DIVISION_NONE) &&
      undividedConfs.size > 1 &&
      undivided.length + divided.length === team.records.length,
    `no DIVI row ${DIVISION_NONE}, yet ${undivided.length} teams carry it across ` +
      `${undividedConfs.size} different conferences — it cannot be a division`,
  );
  check(
    `DGID ${DIVISION_NONE} is all-ones in the field's width`,
    DIVISION_NONE === (1 << (divi.fields.find((f) => f.name === 'DGID')?.bits ?? 0)) - 1,
    `DGID is ${divi.fields.find((f) => f.name === 'DGID')?.bits} bits wide, ` +
      `all-ones = ${DIVISION_NONE}; same sentinel convention as BOWL.SGID = 255`,
  );
  check(
    'no conference is partially divided',
    [...new Set(team.records.map((t) => n(t.CGID)))].every((c) => {
      const mine = team.records.filter((t) => n(t.CGID) === c);
      const d = mine.filter(hasDivision).length;
      return d === 0 || d === mine.length;
    }),
    'every conference is either wholly in divisions or wholly out of them',
  );

  // --- cross-table: BOWL agrees on which conferences split ------------------
  // A conference championship game only exists if the conference has divisions
  // to crown winners of. BOWL was solved before DIVI, so this is a genuine
  // prediction, not a restatement.
  const titleGameConfs = new Set(
    bowl.records.filter(isConferenceChampionship).map((r) => n(r.BCI1)),
  );
  const splitConfs = new Set(rows.map((r) => n(r.CGID)));
  check(
    'the conferences that split are exactly the conferences with a title game in BOWL',
    titleGameConfs.size === splitConfs.size &&
      [...splitConfs].every((c) => titleGameConfs.has(c)),
    `DIVI says {${[...splitConfs].map((c) => confName.get(c)).sort().join(', ')}}; ` +
      `BOWL says {${[...titleGameConfs].map((c) => confName.get(c)).sort().join(', ')}}`,
  );

  // --- cross-table: every divided team is FBS -------------------------------
  const fbs = new Set(play.records.map((p) => playerTeam(n(p.PGID))));
  check(
    'every team in a division is an FBS team with a roster in PLAY',
    divided.every((t) => fbs.has(n(t.TGID))),
    `${divided.length}/${divided.length} — divisions are an FBS-only concept here`,
  );

  // --- ground truth: the real 2006 alignments -------------------------------
  const members = new Map<number, string[]>();
  for (const t of divided) {
    const d = n(t.DGID);
    if (!members.has(d)) members.set(d, []);
    members.get(d)!.push(s(t.TDNA));
  }
  let correct = 0;
  const wrong: string[] = [];
  for (const r of rows) {
    const expected = ALIGNMENT_2006[s(r.DNAM)];
    const actual = (members.get(n(r.DGID)) ?? []).slice().sort();
    if (expected && JSON.stringify(expected.slice().sort()) === JSON.stringify(actual)) {
      correct++;
    } else {
      wrong.push(s(r.DNAM));
    }
  }
  check(
    'all ten divisions have their real 2006 membership, team for team',
    correct === rows.length,
    correct === rows.length
      ? `${correct}/${rows.length} divisions exact (60 teams placed correctly)`
      : `mismatched: ${wrong.join(', ')}`,
  );
  check(
    'the five divided conferences are the right five for 2006',
    JSON.stringify(
      [...splitConfs].map((c) => confName.get(c)).sort(),
    ) === JSON.stringify(['ACC', 'Big 12', 'C-USA', 'MAC', 'SEC']),
    'ACC, Big 12, C-USA, MAC, SEC — the Big Ten, Big East and Pac-10 had no ' +
      'divisions or title game in 2006, and DIVI correctly omits them',
  );

  // --- report ---------------------------------------------------------------
  let failed = 0;
  for (const c of checks) {
    if (!c.pass) failed++;
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  }
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
  if (failed) process.exitCode = 1;
}

main();
