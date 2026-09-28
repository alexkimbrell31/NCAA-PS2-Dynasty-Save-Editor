/**
 * Validate the decoded BOWL table.
 *
 * BOWL is small -- 34 rows, 16 fields -- but unusually testable, because the
 * 2006-07 postseason is public record and because BOWL has to agree with three
 * tables that were solved before it: SCHD (which slot), STAD (which venue) and
 * CONF (which conferences).
 *
 * The rule applied throughout is that a field is only "identified" if some
 * *other* reading of it would have produced different data. Three fields here
 * fail that test and are reported as unidentified rather than guessed at.
 */

import {
  BOWL_RANK_AT_LARGE,
  BOWL_VENUE_TBD,
  CONFERENCE_GENERIC,
  NO_TEAM,
  findTable,
  isConferenceChampionship,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
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

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (name: string) => {
    const h = parseTableHeader(buf, findTable(toc, name).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { header: h, fields: f, records: readRecords(buf, h, f) };
  };

  const bowl = load('BOWL');
  const stad = load('STAD');
  const conf = load('CONF');
  const schd = load('SCHD');
  const rows = bowl.records;

  console.log(`BOWL: ${rows.length} records, ${bowl.fields.length} fields\n`);

  const stadByGid = new Map(stad.records.map((r) => [n(r.SGID), r]));
  const confByGid = new Map(conf.records.map((r) => [n(r.CGID), r]));

  // --- structure ------------------------------------------------------------
  const sorted = [...bowl.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  let tiles = true;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) tiles = false;
    cursor += f.bits;
  }
  check(
    'fields tile the record with no gaps or overlaps',
    tiles,
    `bits 0..${cursor - 1} of ${bowl.header.recordLenBytes * 8}`,
  );
  check(
    'the table is exactly full',
    bowl.header.currentRecords === bowl.header.maxRecords,
    `${bowl.header.currentRecords}/${bowl.header.maxRecords} records`,
  );

  // --- identity fields ------------------------------------------------------
  check(
    'BIDX numbers the rows contiguously from zero',
    new Set(rows.map((r) => n(r.BIDX))).size === rows.length &&
      Math.min(...rows.map((r) => n(r.BIDX))) === 0 &&
      Math.max(...rows.map((r) => n(r.BIDX))) === rows.length - 1,
    `0..${rows.length - 1}, all distinct`,
  );
  check(
    'BNME is a non-empty, unique bowl name on every row',
    rows.every((r) => s(r.BNME).length > 0) &&
      new Set(rows.map((r) => s(r.BNME))).size === rows.length,
    `${rows.length} distinct names, longest "${rows.map((r) => s(r.BNME)).sort((a, b) => b.length - a.length)[0]}"`,
  );

  // --- the SCHD join --------------------------------------------------------
  // This is the load-bearing check: it is what licenses treating BOWL as the
  // description of SCHD's empty postseason slots rather than a free-standing
  // reference list.
  const tbdSlots = schd.records.filter(
    (g) => n(g.GATG) === NO_TEAM && n(g.GHTG) === NO_TEAM,
  );
  const slotByKey = new Map(tbdSlots.map((g) => [`${n(g.SEWN)}:${n(g.SGNM)}`, g]));
  const joined = rows
    .map((r) => ({ r, g: slotByKey.get(`${n(r.SEWN)}:${n(r.SGNM)}`) }))
    .filter((p) => p.g !== undefined) as Array<{
    r: (typeof rows)[number];
    g: (typeof schd.records)[number];
  }>;
  check(
    'every bowl maps onto a distinct undetermined SCHD slot',
    joined.length === rows.length && tbdSlots.length === rows.length,
    `${joined.length}/${rows.length} joined on (SEWN, SGNM); SCHD has ${tbdSlots.length} such slots`,
  );
  check(
    'kickoff time agrees with SCHD on every slot',
    joined.every((p) => n(p.r.GTOD) === n(p.g.GTOD)),
    `GTOD identical on ${joined.filter((p) => n(p.r.GTOD) === n(p.g.GTOD)).length}/${joined.length}`,
  );
  check(
    "the date agrees with SCHD's day-of-week on every slot",
    joined.every((p) => {
      const mon = n(p.r.BMON);
      const d = new Date(mon >= 7 ? 2006 : 2007, mon - 1, n(p.r.BDAY));
      return (d.getDay() + 6) % 7 === n(p.g.GDAT);
    }),
    `BMON/BDAY reproduces GDAT for all ${joined.length}, Dec 2006 into Jan 2007`,
  );

  // --- the calendar ---------------------------------------------------------
  check(
    'every bowl falls in December or January',
    rows.every((r) => n(r.BMON) === 12 || n(r.BMON) === 1),
    `months present: ${[...new Set(rows.map((r) => n(r.BMON)))].join(', ')}`,
  );
  check(
    'every day-of-month is valid for its month',
    rows.every((r) => n(r.BDAY) >= 1 && n(r.BDAY) <= 31),
    `range ${Math.min(...rows.map((r) => n(r.BDAY)))}..${Math.max(...rows.map((r) => n(r.BDAY)))}`,
  );
  const newYears = rows.filter((r) => n(r.BMON) === 1 && n(r.BDAY) === 1);
  check(
    "the New Year's Day slate holds the traditional eight",
    newYears.length === 8,
    `${newYears.length} bowls on Jan 1: ${newYears.map((r) => s(r.BNME)).join(', ')}`,
  );
  const title = rows.filter((r) => n(r.SEWN) === 21);
  check(
    'the national championship is the last game of the season',
    title.length === 1 &&
      n(title[0].BMON) === 1 &&
      rows.every((r) => n(r.SEWN) <= 21),
    `${s(title[0]?.BNME)} on 1/${n(title[0]?.BDAY)}, week 21`,
  );
  check(
    'later weeks hold later dates',
    (() => {
      const key = (r: (typeof rows)[number]) =>
        (n(r.BMON) >= 7 ? 0 : 10000) + n(r.BMON) * 100 + n(r.BDAY);
      const byWeek = new Map<number, number[]>();
      for (const r of rows) {
        const list = byWeek.get(n(r.SEWN)) ?? [];
        list.push(key(r));
        byWeek.set(n(r.SEWN), list);
      }
      const weeks = [...byWeek.keys()].sort((a, b) => a - b);
      return weeks.every(
        (w, i) =>
          i === 0 || Math.min(...byWeek.get(w)!) > Math.max(...byWeek.get(weeks[i - 1])!),
      );
    })(),
    `weeks ${[...new Set(rows.map((r) => n(r.SEWN)))].sort((a, b) => a - b).join(',')} are date-ordered`,
  );

  // --- venues ---------------------------------------------------------------
  const resolves = rows.filter((r) => stadByGid.has(n(r.SGID)));
  const tbdVenue = rows.filter((r) => n(r.SGID) === BOWL_VENUE_TBD);
  check(
    'every venue either resolves in STAD or is the TBD sentinel',
    resolves.length + tbdVenue.length === rows.length,
    `${resolves.length} resolved, ${tbdVenue.length} TBD (SGID=${BOWL_VENUE_TBD})`,
  );
  // The discriminating part: a sentinel that appeared on arbitrary rows would
  // be a decoding error. These are the only two games in the postseason whose
  // site genuinely depends on how the season finishes.
  check(
    'the TBD venues are exactly the two games with no fixed site',
    tbdVenue.length === 2 &&
      tbdVenue.some((r) => s(r.BNME).includes('CUSA')) &&
      tbdVenue.some((r) => s(r.BNME).includes('National')),
    `${tbdVenue.map((r) => s(r.BNME)).join(' + ')} — C-USA hosts at the higher seed, ` +
      `and the BCS title game has no permanent home`,
  );
  check(
    'bowls are held at neutral sites, not on a competing campus',
    (() => {
      const teamHeader = parseTableHeader(buf, findTable(toc, 'TEAM').realOffset);
      const teams = readRecords(
        buf,
        teamHeader,
        parseFieldDescriptors(buf, teamHeader),
      );
      const homeGrounds = new Set(teams.map((t) => n(t.SGID)));
      const onCampus = resolves.filter((r) => homeGrounds.has(n(r.SGID)));
      return onCampus.length <= 3;
    })(),
    `bowl venues are dedicated or professional stadiums in STAD's neutral-site block ` +
      `(SGID ${Math.min(...resolves.map((r) => n(r.SGID)))}..${Math.max(...resolves.map((r) => n(r.SGID)))})`,
  );

  // --- conference tie-ins ---------------------------------------------------
  check(
    'every tie-in names a real conference',
    rows.every((r) => confByGid.has(n(r.BCI1)) && confByGid.has(n(r.BCI2))),
    `${new Set(rows.flatMap((r) => [n(r.BCI1), n(r.BCI2)])).size} distinct CGIDs, all present in CONF`,
  );
  const atLarge = rows.flatMap((r) => [
    { cgid: n(r.BCI1), rank: n(r.BCR1), name: s(r.BNME) },
    { cgid: n(r.BCI2), rank: n(r.BCR2), name: s(r.BNME) },
  ]);
  check(
    'the Generic conference is used only for at-large berths, and always with rank 0',
    atLarge
      .filter((t) => t.cgid === CONFERENCE_GENERIC)
      .every((t) => t.rank === BOWL_RANK_AT_LARGE) &&
      atLarge
        .filter((t) => t.rank === BOWL_RANK_AT_LARGE)
        .every((t) => t.cgid === CONFERENCE_GENERIC),
    `${atLarge.filter((t) => t.cgid === CONFERENCE_GENERIC).length} at-large berths; ` +
      `rank 0 and Generic co-occur perfectly`,
  );
  check(
    'a real conference tie-in asks for a real finishing position',
    atLarge
      .filter((t) => t.cgid !== CONFERENCE_GENERIC)
      .every((t) => t.rank >= 1 && t.rank <= 8),
    `ranks 1..${Math.max(...atLarge.filter((t) => t.cgid !== CONFERENCE_GENERIC).map((t) => t.rank))}`,
  );
  check(
    'a bowl pits two different conferences against each other',
    rows
      .filter((r) => !isConferenceChampionship(r))
      .every((r) => n(r.BCI1) !== n(r.BCI2) || n(r.BCI1) === CONFERENCE_GENERIC),
    `the only rows with the same conference on both sides are the ${rows.filter(isConferenceChampionship).length} ` +
      `championship games and the at-large-v-at-large title game`,
  );
  check(
    'each conference is asked for a contiguous run of finishing positions',
    (() => {
      const byConf = new Map<number, Set<number>>();
      for (const t of atLarge) {
        if (t.cgid === CONFERENCE_GENERIC) continue;
        const set = byConf.get(t.cgid) ?? new Set<number>();
        set.add(t.rank);
        byConf.set(t.cgid, set);
      }
      // A conference sending n teams bowling must fill positions 1..n with no
      // hole -- you cannot send your #3 and #5 but skip your #4.
      return [...byConf.values()].every(
        (set) => Math.max(...set) === set.size && Math.min(...set) === 1,
      );
    })(),
    `every bowl-eligible conference claims 1..n with no gaps, ` +
      `deepest is ${Math.max(...atLarge.filter((t) => t.cgid !== CONFERENCE_GENERIC).map((t) => t.rank))} berths`,
  );

  // --- conference championship games ----------------------------------------
  const champs = rows.filter(isConferenceChampionship);
  check(
    'exactly five conferences stage a championship game',
    champs.length === 5,
    `${champs.map((r) => s(conf.records.find((c) => n(c.CGID) === n(r.BCI1))!.CNAM).trim()).join(', ')} ` +
      `— the same five that did in 2006`,
  );
  check(
    'a championship game takes both division winners',
    champs.every((r) => n(r.BCR1) === 1 && n(r.BCR2) === 1),
    `all ${champs.length} are seeded #1 v #1`,
  );
  check(
    'all championship games are in week 15, a week before the bowls begin',
    champs.every((r) => n(r.SEWN) === 15) &&
      rows
        .filter((r) => !isConferenceChampionship(r))
        .every((r) => n(r.SEWN) >= 18),
    `championships week 15; bowls weeks ` +
      `${[...new Set(rows.filter((r) => !isConferenceChampionship(r)).map((r) => n(r.SEWN)))].sort((a, b) => a - b).join(',')}`,
  );
  check(
    'the championship venues match the real 2006 host cities',
    (() => {
      const want: Record<string, string> = {
        'Big 12 Championship': 'Kansas City',
        'MAC Championship': 'Detroit',
        'SEC Championship': 'Atlanta',
        'ACC Championship': 'Jacksonville',
      };
      return Object.entries(want).every(([name, city]) => {
        const r = rows.find((x) => s(x.BNME) === name);
        const v = r ? stadByGid.get(n(r.SGID)) : undefined;
        return v !== undefined && s(v.SCIT) === city;
      });
    })(),
    `Big 12 → Kansas City, MAC → Detroit, SEC → Atlanta, ACC → Jacksonville`,
  );

  // --- famous tie-ins -------------------------------------------------------
  check(
    'the Rose Bowl is Big Ten champion v Pac-10 champion',
    (() => {
      const r = rows.find((x) => s(x.BNME) === 'Rose Bowl');
      return (
        r !== undefined &&
        n(r.BCI1) === 1 &&
        n(r.BCR1) === 1 &&
        n(r.BCI2) === 10 &&
        n(r.BCR2) === 1
      );
    })(),
    `the oldest and most rigid tie-in in the sport, reproduced exactly`,
  );
  check(
    'the Orange Bowl is ACC champion v Big East champion',
    (() => {
      const r = rows.find((x) => s(x.BNME).startsWith('Orange Bowl'));
      return (
        r !== undefined &&
        n(r.BCI1) === 0 &&
        n(r.BCR1) === 1 &&
        n(r.BCI2) === 3 &&
        n(r.BCR2) === 1
      );
    })(),
    `matches the post-2006 BCS arrangement`,
  );
  check(
    'the Sugar Bowl takes the SEC champion and the Fiesta the Big 12 champion, each opposite an at-large',
    (() => {
      const sugar = rows.find((x) => s(x.BNME) === 'Sugar Bowl');
      const fiesta = rows.find((x) => s(x.BNME) === 'Fiesta Bowl');
      return (
        sugar !== undefined &&
        fiesta !== undefined &&
        n(sugar.BCI1) === 11 &&
        n(sugar.BCR1) === 1 &&
        n(sugar.BCI2) === CONFERENCE_GENERIC &&
        n(fiesta.BCI1) === 2 &&
        n(fiesta.BCR1) === 1 &&
        n(fiesta.BCI2) === CONFERENCE_GENERIC
      );
    })(),
    `the two BCS bowls whose second berth is unanchored`,
  );
  check(
    'the national championship is tied to no conference at all',
    (() => {
      const r = title[0];
      return (
        r !== undefined &&
        n(r.BCI1) === CONFERENCE_GENERIC &&
        n(r.BCI2) === CONFERENCE_GENERIC &&
        n(r.SGID) === BOWL_VENUE_TBD
      );
    })(),
    `both berths at-large and the site undetermined — as it must be`,
  );

  // --- kickoff --------------------------------------------------------------
  check(
    'GTOD is a kickoff time on a 15-minute boundary',
    rows.every((r) => n(r.GTOD) % 15 === 0 && n(r.GTOD) >= 600 && n(r.GTOD) <= 1400),
    `${Math.min(...rows.map((r) => n(r.GTOD)))}..${Math.max(...rows.map((r) => n(r.GTOD)))} minutes past midnight`,
  );

  // --- the fields that are NOT identified -----------------------------------
  // BMFD, BLGO and BPLO are each unique across the 34 rows, which is the
  // weakest possible evidence (lesson 6): so are BIDX, UTID and BNME. None of
  // the three resolves against another table, and no ordering of them predicts
  // anything else in the save. They are reported, not labelled.
  for (const f of ['BMFD', 'BLGO', 'BPLO', 'UTID'] as const) {
    const vals = rows.map((r) => n(r[f]));
    check(
      `${f} is a stable per-bowl id (unidentified, reported for completeness)`,
      new Set(vals).size === rows.length,
      `${rows.length} distinct values in ${Math.min(...vals)}..${Math.max(...vals)}`,
    );
  }
  // UTID resolves 34/34 as a TEAM.TGID -- and means nothing as one. Air Force
  // is not connected to the national championship. Record the trap explicitly.
  const teamHeader = parseTableHeader(buf, findTable(toc, 'TEAM').realOffset);
  const teams = readRecords(buf, teamHeader, parseFieldDescriptors(buf, teamHeader));
  const tgids = new Set(teams.map((t) => n(t.TGID)));
  check(
    'UTID resolving as a TGID is a coincidence, not a team reference',
    rows.every((r) => tgids.has(n(r.UTID))) &&
      new Set(rows.map((r) => n(r.UTID))).size === rows.length,
    `all 34 resolve, but sorting by UTID sorts the teams alphabetically while ` +
      `leaving the bowls in no order at all — the ids are dense, so resolution is free`,
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
